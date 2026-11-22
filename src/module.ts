/**
 * Assembles a domain module from decorated components.
 *
 * Wiring is explicit rather than scanned: the application passes the handler,
 * policy and service classes, and this function registers them in the
 * container, instantiates them, builds the handler maps, subscribes policy
 * methods and builds the event-storming flow graph. Every wiring mistake is
 * reported at startup, before the server accepts a request.
 */

import { NoopAuditWriter } from "./audit.ts";
import type { AuditWriter } from "./audit.ts";
import { CommandBus } from "./commandBus.ts";
import type { RegisteredCommandHandler } from "./commandBus.ts";
import { Container, InjectionToken } from "./container.ts";
import type { Token } from "./container.ts";
import { ApplicationEventPublisher } from "./events.ts";
import type {
  CommandFlow,
  CqrsFlow,
  PolicyFlow,
  PolicyListenerFlow,
  QueryFlow,
} from "./flow.ts";
import { classMetaOf, hasDomainMetadata, methodMetaOf } from "./metadata.ts";
import type { CqrsClassMeta, EventListenerMeta, PayloadMeta } from "./metadata.ts";
import { QueryBus } from "./queryBus.ts";
import type { RegisteredQueryHandler } from "./queryBus.ts";
import { NoTransactionRunner } from "./unitOfWork.ts";
import type { TransactionRunner } from "./unitOfWork.ts";
import { Command, DomainEvent, Query } from "./types.ts";
import type { Constructor, EventClass, ICommandHandler } from "./types.ts";

/** Port the application implements to open transactions (Prisma, TypeORM, …). */
export const TRANSACTION_RUNNER = new InjectionToken<TransactionRunner>("TransactionRunner");
/** Port the application implements to persist audit rows. */
export const AUDIT_WRITER = new InjectionToken<AuditWriter>("AuditWriter");

export interface CqrsModuleOptions {
  /** Pre-populated with the application's own providers (db, unit of work, audit writer…). */
  container: Container;
  /** Every decorated handler, policy and service class. */
  components: Constructor[];
  /**
   * Require `@Actor`/`@BoundedContext` on commands, queries and events, and
   * require events to extend `DomainEvent`. Recommended for compiled builds:
   * the class-level decorator is what keeps their names stable under
   * `--minify`, and those names are the audit/flow vocabulary.
   */
  strictDomainTypes?: boolean;
}

export interface CqrsModule {
  readonly container: Container;
  readonly commandBus: CommandBus;
  readonly queryBus: QueryBus;
  readonly events: ApplicationEventPublisher;
  /** The event-storming graph; includes events discovered while running. */
  flow(): CqrsFlow;
}

interface ListenerMethod {
  readonly name: string;
  readonly meta: EventListenerMeta;
}

export function createCqrsModule(options: CqrsModuleOptions): CqrsModule {
  const { container, components } = options;
  const strict = options.strictDomainTypes ?? false;

  const transactionRunner = container.has(TRANSACTION_RUNNER)
    ? container.resolve(TRANSACTION_RUNNER)
    : new NoTransactionRunner();
  const auditWriter = container.has(AUDIT_WRITER)
    ? container.resolve(AUDIT_WRITER)
    : new NoopAuditWriter();

  const runtimeEventClasses = new Set<Constructor>();
  const publisher = new ApplicationEventPublisher();
  const commandBus = new CommandBus({
    publisher,
    transactionRunner,
    auditWriter,
    strictDomainTypes: strict,
    onDomainEvent: (eventClass) => runtimeEventClasses.add(eventClass),
  });
  const queryBus = new QueryBus();

  // Registered before components are instantiated so a handler/policy may
  // inject the buses or the publisher.
  container.registerValue(ApplicationEventPublisher, publisher);
  container.registerValue(CommandBus, commandBus);
  container.registerValue(QueryBus, queryBus);

  const instances = new Map<Constructor, any>();
  const errors: string[] = [];

  // 1. Register and instantiate components.
  for (const component of components) {
    const meta = classMetaOf(component);
    if (!meta) {
      errors.push(
        `${component.name} is not decorated; use @CommandHandler, @QueryHandler, @Policy or @Service`,
      );
      continue;
    }
    if (container.has(component)) {
      errors.push(`${component.name} is already registered in the container`);
      continue;
    }
    container.registerClass(component, component, injectFor(meta));
  }
  if (errors.length > 0) throw invalidModule(errors);

  for (const component of components) {
    instances.set(component, container.resolve(component));
  }

  // 2. Build the handler maps and the flow graph, collecting every problem.
  const commandHandlers = new Map<Constructor, RegisteredCommandHandler>();
  const queryHandlers = new Map<Constructor, RegisteredQueryHandler>();
  const commandFlows: CommandFlow[] = [];
  const queryFlows: QueryFlow[] = [];
  const policyFlows: PolicyFlow[] = [];
  const eventContexts = new Map<string, string>();
  const eventPayloads = new Map<string, Record<string, string>>();
  /** Nested shapes referenced by payload types, gathered from every @Payload. */
  const dtos: CqrsFlow["dtos"] = {};

  /**
   * Take a declared payload: its nested shapes join the graph's `dtos`, and its
   * fields become the node's payload. A class without `@Payload` carries none.
   */
  const rememberPayload = (meta: PayloadMeta | undefined): Record<string, string> => {
    if (!meta) return {};
    if (meta.dtos) Object.assign(dtos, meta.dtos);
    return { ...meta.fields };
  };
  const invariantFlows: CqrsFlow["invariants"] = [];

  // `DomainEvent` is the one class whose name the minifier may rename: it is
  // the library's base class, not an application class with a domain
  // annotation. The flow graph reports the logical name instead of the mangled
  // symbol.
  const eventNameOf = (eventClass: EventClass): string =>
    eventClass === DomainEvent ? "DomainEvent" : eventClass.name;

  const defineEvent = (eventClass: EventClass, where: string): void => {
    // Listening to the base class is how a policy observes every event; the
    // base itself is abstract and never emitted, so it is not a flow node.
    if (eventClass === DomainEvent) return;
    if (!(eventClass.prototype instanceof DomainEvent)) {
      errors.push(`${where}: ${eventClass.name} must extend DomainEvent`);
      return;
    }
    if (strict && !hasDomainMetadata(eventClass)) {
      errors.push(
        `${where}: ${eventClass.name} needs @BoundedContext(...) or @Actor(...) ` +
          `(the annotation also keeps its name under --minify)`,
      );
      return;
    }
    if (!eventContexts.has(eventClass.name)) {
      eventContexts.set(eventClass.name, classMetaOf(eventClass)?.boundedContext ?? "");
    }
    if (!eventPayloads.has(eventClass.name)) {
      eventPayloads.set(eventClass.name, rememberPayload(classMetaOf(eventClass)?.payload));
    }
  };

  for (const component of components) {
    const meta = classMetaOf(component) as CqrsClassMeta;
    const instance = instances.get(component);
    const listeners = listenerMethodsOf(component);

    if (meta.commandHandler) {
      const { command, emits } = meta.commandHandler;
      if (!(command.prototype instanceof Command)) {
        errors.push(`${component.name}: ${command.name} must extend Command<R>`);
      }
      if (strict && !hasDomainMetadata(command)) {
        errors.push(
          `${command.name} needs @Actor(...) or @BoundedContext(...) ` +
            `(the annotation also keeps its name under --minify)`,
        );
      }

      const existing = commandHandlers.get(command);
      if (existing) {
        errors.push(
          `Multiple handlers for command ${command.name}: ` +
            `${existing.handlerClass.name} and ${component.name}`,
        );
      } else {
        const transactionMode = meta.transaction?.mode ?? "required";
        commandHandlers.set(command, {
          command,
          handler: instance as ICommandHandler<any, any>,
          handlerClass: component,
          transactionMode,
        });
        commandFlows.push({
          name: command.name,
          handler: component.name,
          context: classMetaOf(command)?.boundedContext ?? "",
          actors: [...(classMetaOf(command)?.actors ?? [])],
          transaction: transactionMode,
          emits: emits.map((eventClass) => eventClass.name),
          payload: rememberPayload(classMetaOf(command)?.payload),
        });
      }

      for (const eventClass of emits) {
        defineEvent(eventClass, `${component.name} emits ${eventClass.name}`);
      }
    }

    if (meta.queryHandler) {
      const { query } = meta.queryHandler;
      if (!(query.prototype instanceof Query)) {
        errors.push(`${component.name}: ${query.name} must extend Query<R>`);
      }
      if (strict && !hasDomainMetadata(query)) {
        errors.push(
          `${query.name} needs @Actor(...) or @BoundedContext(...) ` +
            `(the annotation also keeps its name under --minify)`,
        );
      }

      const existing = queryHandlers.get(query);
      if (existing) {
        errors.push(
          `Multiple handlers for query ${query.name}: ` +
            `${existing.handlerClass.name} and ${component.name}`,
        );
      } else {
        queryHandlers.set(query, {
          query,
          handler: instance,
          handlerClass: component,
        });
        queryFlows.push({
          name: query.name,
          handler: component.name,
          context: classMetaOf(query)?.boundedContext ?? "",
          actors: [...(classMetaOf(query)?.actors ?? [])],
          payload: rememberPayload(classMetaOf(query)?.payload),
        });
      }
    }

    if (meta.policy) {
      const listensTo = new Set<string>();
      const sends = new Set<string>();
      const policyListeners: PolicyListenerFlow[] = [];
      for (const listener of listeners) {
        defineEvent(
          listener.meta.event,
          `${component.name}.${listener.name} listens to ${eventNameOf(listener.meta.event)}`,
        );
        listensTo.add(eventNameOf(listener.meta.event));
        const listenerSends: string[] = [];
        for (const sentCommand of listener.meta.sends) {
          if (!(sentCommand.prototype instanceof Command)) {
            errors.push(
              `${component.name}.${listener.name}: @EventListener sends ${sentCommand.name}, ` +
                `which must extend Command<R>`,
            );
          }
          sends.add(sentCommand.name);
          listenerSends.push(sentCommand.name);
        }
        policyListeners.push({
          event: eventNameOf(listener.meta.event),
          sends: listenerSends.sort(),
          rules: [...(methodMetaOf(component.prototype[listener.name])?.invariants ?? [])],
        });
      }
      // A policy that opts out of the flow is still wired up; the graph just
      // leaves it (and its invariants) out.
      if (!meta.policy.excludeFromFlow) {
        policyFlows.push({
          name: component.name,
          listensTo: [...listensTo].sort(),
          sends: [...sends].sort(),
          // One entry per @EventListener method: the unions above cannot pair
          // an event with the command that reaction sends, this can.
          listeners: policyListeners,
        });
      }
    } else if (listeners.length > 0) {
      errors.push(`${component.name} has @EventListener methods but no @Policy() decorator`);
    }

    // An excluded policy is not in the graph, so neither are its invariants.
    if (!meta.policy?.excludeFromFlow) {
      invariantFlows.push(...collectInvariants(component, Boolean(meta.policy), errors));
    }
  }

  if (errors.length > 0) throw invalidModule(errors);

  // 3. Subscribe the policy methods.
  for (const component of components) {
    if (!classMetaOf(component)?.policy) continue;
    const instance = instances.get(component);
    for (const listener of listenerMethodsOf(component)) {
      publisher.subscribe(
        listener.meta.event,
        (event) => (instance as any)[listener.name](event),
        `${component.name}.${listener.name}`,
      );
    }
  }

  commandBus.registerHandlers(commandHandlers);
  queryBus.registerHandlers(queryHandlers);

  const baseFlow: CqrsFlow = {
    commands: commandFlows.sort(byName),
    queries: queryFlows.sort(byName),
    policies: policyFlows.sort(byName),
    events: [...eventContexts]
      .map(([name, context]) => ({
        name,
        context,
        payload: eventPayloads.get(name) ?? {},
      }))
      .sort(byName),
    invariants: invariantFlows.sort(
      (left, right) =>
        left.component.localeCompare(right.component) || left.method.localeCompare(right.method),
    ),
    dtos,
  };

  return {
    container,
    commandBus,
    queryBus,
    events: publisher,
    flow(): CqrsFlow {
      // An event emitted but not declared in `emits` is still real; add it so a
      // graph opened after the first request is complete.
      const events = new Map(baseFlow.events.map((event) => [event.name, event]));
      for (const eventClass of runtimeEventClasses) {
        if (events.has(eventClass.name)) continue;
        events.set(eventClass.name, {
          name: eventClass.name,
          context: classMetaOf(eventClass)?.boundedContext ?? "",
          payload: rememberPayload(classMetaOf(eventClass)?.payload),
        });
      }
      return {
        commands: [...baseFlow.commands],
        queries: [...baseFlow.queries],
        policies: [...baseFlow.policies],
        events: [...events.values()].sort(byName),
        invariants: [...baseFlow.invariants],
        dtos: { ...baseFlow.dtos },
      };
    },
  };
}

function injectFor(meta: CqrsClassMeta): Token[] {
  return (
    meta.commandHandler?.inject ??
    meta.queryHandler?.inject ??
    meta.policy?.inject ??
    meta.service?.inject ??
    []
  );
}

function listenerMethodsOf(component: Constructor): ListenerMethod[] {
  const methods: ListenerMethod[] = [];
  for (const name of Object.getOwnPropertyNames(component.prototype)) {
    if (name === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(component.prototype, name);
    const fn = descriptor?.value;
    if (typeof fn !== "function") continue;
    const meta = methodMetaOf(fn);
    if (meta?.eventListener) methods.push({ name, meta: meta.eventListener });
  }
  return methods;
}

/**
 * Invariants belong to the policy reaction, not to the command handler.
 *
 * A policy listener explains why an event causes another command. A handler
 * simply enforces its own local consistency; putting those implementation rules
 * in the flow graph makes the graph describe code shape instead of business
 * routing. Startup rejects an `@Invariant` anywhere else.
 */
function collectInvariants(
  component: Constructor,
  isPolicy: boolean,
  errors: string[],
): CqrsFlow["invariants"] {
  const invariants: CqrsFlow["invariants"] = [];
  for (const name of Object.getOwnPropertyNames(component.prototype)) {
    if (name === "constructor") continue;
    const descriptor = Object.getOwnPropertyDescriptor(component.prototype, name);
    const fn = descriptor?.value;
    if (typeof fn !== "function") continue;

    const methodMeta = methodMetaOf(fn);
    const rules = methodMeta?.invariants;
    if (!rules?.length) continue;

    if (!isPolicy || !methodMeta?.eventListener) {
      errors.push(
        `${component.name}.${name}: @Invariant is only allowed on an @EventListener method of a @Policy`,
      );
      continue;
    }
    invariants.push({ component: component.name, method: name, rules: [...rules] });
  }
  return invariants;
}

function byName(left: { name: string }, right: { name: string }): number {
  return left.name.localeCompare(right.name);
}

function invalidModule(errors: string[]): Error {
  return new Error(`cqrs: invalid CQRS module:\n - ${errors.join("\n - ")}`);
}

/**
 * The command bus.
 *
 * One `send()` owns a command from dispatch to audit:
 *
 *   resolve handler -> buffer command audit row -> run handler (in a
 *   transaction unless told otherwise) -> dispatch immediate events ->
 *   commit -> dispatch post-commit events -> write one audit batch
 *
 * Nested sends (a policy reacting to an event) reuse the ambient transaction
 * and append to the parent request's audit batch. They never open a second
 * transaction and never flush on their own.
 */

import { formatFailure, serializePayload } from "./audit.ts";
import type { AuditRecord, AuditWriter } from "./audit.ts";
import { currentContext, createRequestContext, nextAuditOrder, runWithRequestContext } from "./context.ts";
import type { RequestContext } from "./context.ts";
import type { CommandContext, EventWrapper } from "./events.ts";
import { ApplicationEventPublisher, EventQueue } from "./events.ts";
import { hasDomainMetadata, typeNameOf } from "./metadata.ts";
import type { TransactionMode } from "./metadata.ts";
import type { TransactionRunner } from "./unitOfWork.ts";
import { Command, DomainEvent } from "./types.ts";
import type { Constructor, ICommandHandler } from "./types.ts";

export interface RegisteredCommandHandler {
  readonly command: Constructor;
  readonly handler: ICommandHandler<any, any>;
  readonly handlerClass: Constructor;
  readonly transactionMode: TransactionMode;
}

export interface CommandBusOptions {
  publisher: ApplicationEventPublisher;
  transactionRunner: TransactionRunner;
  auditWriter: AuditWriter;
  /**
   * Enforce that every command carries `@Actor`/`@BoundedContext` and every
   * emitted event extends `DomainEvent` and is decorated. The decorator is also
   * what keeps class names (audit `event_type`, flow node names) intact under
   * `bun build --minify`.
   */
  strictDomainTypes?: boolean;
  /** Called once per emitted event class, so the flow graph can grow at runtime. */
  onDomainEvent?: (eventClass: Constructor) => void;
}

export class CommandBus {
  private readonly publisher: ApplicationEventPublisher;
  private readonly transactionRunner: TransactionRunner;
  private readonly auditWriter: AuditWriter;
  private readonly strictDomainTypes: boolean;
  private readonly onDomainEvent?: (eventClass: Constructor) => void;
  private handlers = new Map<Constructor, RegisteredCommandHandler>();

  constructor(options: CommandBusOptions) {
    this.publisher = options.publisher;
    this.transactionRunner = options.transactionRunner;
    this.auditWriter = options.auditWriter;
    this.strictDomainTypes = options.strictDomainTypes ?? false;
    this.onDomainEvent = options.onDomainEvent;
  }

  registerHandlers(handlers: ReadonlyMap<Constructor, RegisteredCommandHandler>): void {
    this.handlers = new Map(handlers);
  }

  async send<R>(command: Command<R>): Promise<R> {
    if (typeof command !== "object" || command === null) {
      throw new TypeError("commandBus.send expects a command instance");
    }

    // values from async local storage, so each time it send, it gets the value from the same scope of the HTTP request it originates.
    const context = currentContext();
    if (!context) {
      // top level request has no context
      const freshContext = createRequestContext();
      // same async storage as above (currentContext), they share the same storage in the same module
      return runWithRequestContext(freshContext, () => this.dispatchTopLevel(command, freshContext));
    }
    if (context.depth === 0) return this.dispatchTopLevel(command, context);
    return this.dispatch(command, context);
  }

  // ---------------------------------------------------------------------------
  // Top level: owns post-commit dispatch, the audit flush and the request buffer

  private async dispatchTopLevel<R>(command: Command<R>, context: RequestContext): Promise<R> {
    // Keeping depth > 0 through the drain means a command sent by a
    // post-commit listener is treated as nested: it must not flush the parent
    // request's audit batch or clear its buffers.
    context.depth += 1;

    let succeeded = false;
    let result: R | undefined;
    let failure: unknown;

    try {
      result = await this.dispatch(command, context);
      succeeded = true;
    } catch (error) {
      failure = error;
    }

    try {
      if (succeeded) await this.drainPostCommit(context);
    } finally {
      try {
        await this.flushAudit(context, succeeded, failure);
      } finally {
        context.depth -= 1;
        context.records.length = 0;
        context.postCommit.length = 0;
        context.nextOrder = 0;
      }
    }

    if (!succeeded) throw failure;
    return result as R;
  }

  // ---------------------------------------------------------------------------
  // One command invocation (top level or nested)

  private async dispatch<R>(command: Command<R>, context: RequestContext): Promise<R> {
    const registration = this.handlers.get(command.constructor as Constructor);
    if (!registration) {
      throw new Error(
        `No handler registered for command ${typeNameOf(command)}. ` +
        `Registered commands: [${[...this.handlers.keys()].map((ctor) => ctor.name).join(", ")}]`,
      );
    }

    const recordStart = context.records.length;
    const postCommitStart = context.postCommit.length;
    const commandRecord = this.startCommandRecord(context, command);

    const queue = new EventQueue((wrapper) => {
      wrapper.record = this.startEventRecord(context, wrapper.event);
    });
    const handlerContext: CommandContext = {
      requestId: context.requestId,
      actor: context.actor,
      events: queue,
    };

    context.depth += 1;
    let result: R | undefined;
    try {
      const invoke = async () => {
        result = (await registration.handler.handle(command, handlerContext)) as R;
        // Policies run before the transaction commits, so an immediate policy
        // failure rolls the business write back (Spring's publishEvent does the
        // same inside the transaction).
        await this.dispatchImmediate(queue);
        commandRecord.success = true;
      };

      if (registration.transactionMode === "none" || this.transactionRunner.isActive()) {
        await invoke();
      } else {
        await this.transactionRunner.run(invoke);
      }

      // Registered only after the transaction committed: a failed command must
      // not leave post-commit side effects behind.
      context.postCommit.push(...queue.getPostCommitEvents());
    } catch (error) {
      context.postCommit.length = postCommitStart;
      this.markSliceFailed(context, recordStart, error);
      throw error;
    } finally {
      context.depth -= 1;
    }

    return result as R;
  }

  private async dispatchImmediate(queue: EventQueue): Promise<void> {
    for (const wrapper of queue.getImmediateEvents()) {
      await this.publisher.publish(wrapper.event);
    }
  }

  private async drainPostCommit(context: RequestContext): Promise<void> {
    // The queue can grow while it is drained: a post-commit listener may send a
    // nested command whose own post-commit events are appended here.
    while (context.postCommit.length > 0) {
      const wrapper = context.postCommit.shift() as EventWrapper<object>;
      try {
        await this.publisher.publish(wrapper.event);
      } catch (error) {
        if (wrapper.record) {
          wrapper.record.success = false;
          wrapper.record.failureReason = formatFailure(error);
        }
        // A post-commit side effect must not fail the command that already
        // committed; log it and keep draining.
        console.error(
          `[cqrs] post-commit listener failed for ${typeNameOf(wrapper.event)} ` +
          `(requestId=${context.requestId}):`,
          error,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Audit

  private startCommandRecord(context: RequestContext, command: object): AuditRecord {
    const record: AuditRecord = {
      type: typeNameOf(command),
      payload: serializePayload(command),
      order: nextAuditOrder(context),
      requestId: context.requestId,
      actor: context.actor,
      createdAt: Date.now(),
      success: false,
      failureReason: "",
    };
    context.records.push(record);
    return record;
  }

  private startEventRecord(context: RequestContext, event: object): AuditRecord {
    if (this.strictDomainTypes) this.assertEventClass(event);
    this.onDomainEvent?.(event.constructor as Constructor);

    const record: AuditRecord = {
      type: typeNameOf(event),
      payload: serializePayload(event),
      order: nextAuditOrder(context),
      requestId: context.requestId,
      actor: context.actor,
      createdAt: Date.now(),
      success: true,
      failureReason: "",
    };
    context.records.push(record);
    return record;
  }

  private markSliceFailed(context: RequestContext, start: number, error: unknown): void {
    const reason = formatFailure(error);
    for (let index = start; index < context.records.length; index += 1) {
      const record = context.records[index];
      if (!record) continue;
      record.success = false;
      if (!record.failureReason) record.failureReason = reason;
    }
  }

  private async flushAudit(
    context: RequestContext,
    committed: boolean,
    failure: unknown,
  ): Promise<void> {
    if (context.records.length === 0) return;

    if (!committed) {
      // The whole request rolled back. Records that were still marked
      // successful did not survive, so they are stamped failed here. A nested
      // command that already failed keeps its more precise reason.
      const reason = formatFailure(failure ?? new Error("Command failed"));
      for (const record of context.records) {
        if (record.success) record.success = false;
        if (!record.failureReason) record.failureReason = reason;
      }
    }

    const records = [...context.records].sort((left, right) => left.order - right.order);
    try {
      await this.auditWriter.write({ requestId: context.requestId, committed, records });
    } catch (error) {
      // Audit is an observation, not part of the command. A broken audit store
      // must not turn a committed write into an HTTP 500.
      console.error(
        `[cqrs] audit write failed for request ${context.requestId} ` +
        `(${records.length} record(s)):`,
        error,
      );
    }
  }

  private assertEventClass(event: object): void {
    if (!(event instanceof DomainEvent)) {
      throw new TypeError(
        `Domain event ${typeNameOf(event)} must extend DomainEvent (cqrs strict mode)`,
      );
    }
    if (!hasDomainMetadata(event.constructor as Function)) {
      throw new TypeError(
        `Domain event ${typeNameOf(event)} needs a class-level @BoundedContext(...) or @Actor(...) ` +
        `annotation (cqrs strict mode; the annotation also keeps its name under --minify)`,
      );
    }
  }
}

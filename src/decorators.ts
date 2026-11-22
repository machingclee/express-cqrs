/**
 * The Node variant of the cqrs annotation set.
 *
 * Java's annotations are compile-time metadata read by Spring and by the
 * library's bytecode scanners. Here they are TC39 class/method decorators that
 * write the same metadata into `metadata.ts`; `createCqrsModule` reads it at
 * startup.
 *
 * Standard decorators are used (the backend tsconfig does not enable
 * `experimentalDecorators`), so no `reflect-metadata` and no extra tsconfig
 * flags are involved.
 */

import type { Token } from "./container.ts";
import { ensureClassMeta, ensureMethodMeta } from "./metadata.ts";
import type { Constructor, DomainEvent, EventClass } from "./types.ts";

export interface ServiceOptions {
  inject?: Token[];
}

export interface PolicyOptions extends ServiceOptions {
  /**
   * Leave this policy out of the flow graph (`GET /docs/commands`) and the
   * diagram built from it. Useful for infrastructure listeners such as a
   * development event log, which subscribe to `DomainEvent` and would otherwise
   * add an edge from every node.
   */
  excludeFromFlow?: boolean;
}

export interface CommandHandlerOptions {
  inject?: Token[];
  /** Events the handler emits; used by the flow graph and startup validation. */
  emits?: Constructor<DomainEvent>[];
  /**
   * The subset of `emits` this handler dispatches after the transaction
   * commits (`context.events.addTransactional`). Every entry must also appear
   * in `emits`. The flow graph marks those emissions, and `add(...)` on one of
   * them throws, so the declaration and the call site cannot disagree.
   */
  afterCommit?: Constructor<DomainEvent>[];
}

export interface QueryHandlerOptions {
  inject?: Token[];
}

export interface EventListenerOptions {
  /** Commands this listener may dispatch; used by the flow graph. */
  sends?: Constructor[];
}

export interface TransactionalOptions {
  /**
   * `required` (default) lets the bus open a transaction for a top-level
   * command and reuse an ambient one for a nested command. `none` lets a
   * handler opt out when it performs its own I/O and transaction management.
   * The PdfNoteManagement application uses only `required`.
   */
  mode?: "required" | "none";
}

/** Who initiates the command/query (event-storming "actor"). */
export function Actor(...actors: string[]) {
  return function (value: Function, _context: ClassDecoratorContext): void {
    ensureClassMeta(value).actors = [...actors];
  };
}

/**
 * Declares the fields a command, query or event carries.
 *
 * The reference Java project reflects its command/DTO classes to build the same
 * information. JavaScript has no runtime types, so the payload is stated once,
 * next to the class: `@Payload({ id: "number", name: "string" })`. Pass `dtos`
 * for nested shapes, and a payload type may then name one of them.
 */
export function Payload(
  fields: Record<string, string>,
  dtos?: Record<string, Record<string, string>>,
) {
  return function (value: Function, _context: ClassDecoratorContext): void {
    ensureClassMeta(value).payload = { fields, dtos };
  };
}

/** The bounded context a command, query or event belongs to. */
export function BoundedContext(name: string) {
  return function (value: Function, _context: ClassDecoratorContext): void {
    ensureClassMeta(value).boundedContext = name;
  };
}

/** Business rules for a policy's @EventListener method; documentation only. */
export function Invariant(...rules: string[]) {
  return function (value: Function, _context: ClassMethodDecoratorContext): void {
    const meta = ensureMethodMeta(value);
    meta.invariants = [...(meta.invariants ?? []), ...rules];
  };
}

/** Injectable component that is not a handler or a policy. */
export function Service(options: ServiceOptions = {}) {
  return function (value: Function, _context: ClassDecoratorContext): void {
    ensureClassMeta(value).service = { inject: options.inject ?? [] };
  };
}

/** Component that owns `@EventListener` methods. */
export function Policy(options: PolicyOptions = {}) {
  return function (value: Function, _context: ClassDecoratorContext): void {
    ensureClassMeta(value).policy = {
      inject: options.inject ?? [],
      ...(options.excludeFromFlow ? { excludeFromFlow: true } : {}),
    };
  };
}

/** Routes a command class to the decorated handler class. */
export function CommandHandler(command: Constructor, options: CommandHandlerOptions = {}) {
  return function (value: Function, _context: ClassDecoratorContext): void {
    ensureClassMeta(value).commandHandler = {
      command,
      inject: options.inject ?? [],
      afterCommit: options.afterCommit ?? [],
      emits: options.emits ?? [],
    };
  };
}

/** Routes a query class to the decorated handler class. */
export function QueryHandler(query: Constructor, options: QueryHandlerOptions = {}) {
  return function (value: Function, _context: ClassDecoratorContext): void {
    ensureClassMeta(value).queryHandler = { query, inject: options.inject ?? [] };
  };
}

/** Marks a method as a listener for one event class (or a superclass of it). */
export function EventListener(eventClass: EventClass, options: EventListenerOptions = {}) {
  return function (value: Function, _context: ClassMethodDecoratorContext): void {
    ensureMethodMeta(value).eventListener = {
      event: eventClass,
      sends: options.sends ?? [],
    };
  };
}

/** Selects the transaction behaviour for a command handler. */
export function Transactional(options: TransactionalOptions = {}) {
  return function (value: Function, _context: ClassDecoratorContext): void {
    ensureClassMeta(value).transaction = { mode: options.mode ?? "required" };
  };
}

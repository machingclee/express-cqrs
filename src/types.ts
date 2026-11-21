/**
 * Types shared by the decorators, the buses and the application's handlers.
 *
 * The Java prototype discovers a handler's command type by reflecting the
 * generic arguments of `CommandHandler<C, R>`. TypeScript erases generic
 * arguments at runtime, so the command/query class is declared explicitly in
 * the handler decorator and the result type is carried by these marker base
 * classes at the type level only.
 */

import type { CommandContext } from "./events.ts";

export type Constructor<T = unknown> = new (...args: any[]) => T;
export type AbstractConstructor<T = unknown> = abstract new (...args: any[]) => T;
export type MaybePromise<T> = T | Promise<T>;

/** A concrete or abstract event class: `@EventListener(DomainEvent)` may listen to a base class. */
export type EventClass<E = any> = Constructor<E> | AbstractConstructor<E>;

/**
 * Marker for a write operation that returns `R`.
 *
 * The result field is `declare`d, so it exists only for type inference and is
 * never emitted into an instance (and therefore never reaches the audit
 * payload).
 */
export abstract class Command<R = void> {
  declare readonly __resultType?: R;
}

/** Marker for a read-only operation that returns `R`. */
export abstract class Query<R = void> {
  declare readonly __resultType?: R;
}

export type CommandResult<C> = C extends Command<infer R> ? R : never;
export type QueryResult<Q> = Q extends Query<infer R> ? R : never;

/**
 * Marker for something that happened in the domain and may be observed by
 * policies. `occurredAt` is plain data, so it also lands in the audit payload.
 *
 * Extending this class is what makes a catch-all `@EventListener(DomainEvent)`
 * possible: listener matching is `event instanceof registeredClass`.
 */
export abstract class DomainEvent {
  readonly occurredAt: number = Date.now();
}

/**
 * A command handler. The command class is bound at runtime by
 * `@CommandHandler(Cmd)`; the generic parameters only type `handle`.
 */
export interface ICommandHandler<C extends Command<any>, R = CommandResult<C>> {
  handle(command: C, context: CommandContext): MaybePromise<R>;
}

/** A query handler; bound at runtime by `@QueryHandler(Q)`. */
export interface IQueryHandler<Q extends Query<any>, R = QueryResult<Q>> {
  handle(query: Q): MaybePromise<R>;
}

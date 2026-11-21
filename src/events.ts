/**
 * Domain-event queue and the application event publisher.
 *
 * `EventQueue` is the handler-facing part: `add` dispatches during the command
 * transaction (policies can react and send nested commands), `addTransactional`
 * defers until the transaction has committed. This mirrors the Java prototype's
 * `SmartEventQueue` and `DispatchTiming`.
 *
 * `ApplicationEventPublisher` is the Node equivalent of Spring's publisher:
 * listeners are registered against an event class and are matched with
 * `instanceof`, so a listener on `DomainEvent` sees every event. Dispatch is
 * sequential and awaited, which keeps policy/nested-command ordering
 * deterministic.
 */

import type { AuditRecord } from "./audit.ts";
import type { EventClass, MaybePromise } from "./types.ts";

export type DispatchTiming = "immediate" | "post_commit";

export interface EventWrapper<E = object> {
  readonly event: E;
  readonly timing: DispatchTiming;
  /** Audit row created when the event was emitted. */
  record?: AuditRecord;
}

export type EventRecorder = (wrapper: EventWrapper<object>) => void;

export class EventQueue {
  private readonly wrappers: EventWrapper<object>[] = [];

  constructor(private readonly recorder?: EventRecorder) {}

  add(event: object): void {
    this.push(event, "immediate");
  }

  addTransactional(event: object): void {
    this.push(event, "post_commit");
  }

  addAll(events: readonly object[]): void {
    for (const event of events) this.add(event);
  }

  addAllTransactional(events: readonly object[]): void {
    for (const event of events) this.addTransactional(event);
  }

  getImmediateEvents(): EventWrapper<object>[] {
    return this.wrappers.filter((wrapper) => wrapper.timing === "immediate");
  }

  getPostCommitEvents(): EventWrapper<object>[] {
    return this.wrappers.filter((wrapper) => wrapper.timing === "post_commit");
  }

  getAllEvents(): EventWrapper<object>[] {
    return [...this.wrappers];
  }

  private push(event: object, timing: DispatchTiming): void {
    const wrapper: EventWrapper<object> = { event, timing };
    this.recorder?.(wrapper);
    this.wrappers.push(wrapper);
  }
}

/** The context handed to a command handler. */
export interface CommandContext {
  readonly requestId: string;
  readonly actor: string | null;
  readonly events: EventQueue;
}

interface RegisteredListener {
  readonly eventClass: EventClass;
  readonly handler: (event: any) => unknown;
  readonly source: string;
}

export class ApplicationEventPublisher {
  private readonly listeners: RegisteredListener[] = [];

  /**
   * Listen to `eventClass` and its subclasses. Returns an unsubscribe
   * function so non-decorator code can stop listening.
   */
  subscribe<E = any>(
    eventClass: EventClass<E>,
    handler: (event: E) => MaybePromise<unknown>,
    source = "",
  ): () => void {
    const listener: RegisteredListener = { eventClass, handler, source };
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) this.listeners.splice(index, 1);
    };
  }

  async publish(event: object): Promise<void> {
    // Snapshot so a listener that subscribes/unsubscribes during dispatch does
    // not change who receives this event.
    for (const listener of [...this.listeners]) {
      if (!(event instanceof (listener.eventClass as Function))) continue;
      await listener.handler(event);
    }
  }

  get listenerCount(): number {
    return this.listeners.length;
  }
}

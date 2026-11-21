/**
 * Per-request execution context.
 *
 * `AsyncLocalStorage` is what lets a handler, a policy and a nested command
 * find the same request id, audit buffer and post-commit queue without passing
 * them through every signature. The Express middleware opens one context per
 * HTTP request; the command bus opens one when it is called outside HTTP.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { AuditRecord } from "./audit.ts";
import type { EventWrapper } from "./events.ts";

export interface RequestContext {
  readonly requestId: string;
  readonly actor: string | null;
  /** 0 outside a command; > 0 while a command (or its post-commit drain) runs. */
  depth: number;
  /** Next `event_order` for this request's audit batch. */
  nextOrder: number;
  records: AuditRecord[];
  postCommit: EventWrapper<object>[];
}

const storage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(
  options: { requestId?: string; actor?: string | null } = {},
): RequestContext {
  return {
    requestId: options.requestId ?? randomUUID(),
    actor: options.actor ?? null,
    depth: 0,
    nextOrder: 0,
    records: [],
    postCommit: [],
  };
}

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function currentContext(): RequestContext | undefined {
  return storage.getStore();
}

export function currentRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

export function nextAuditOrder(context: RequestContext): number {
  const order = context.nextOrder;
  context.nextOrder += 1;
  return order;
}

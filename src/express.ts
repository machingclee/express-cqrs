/**
 * Optional Express adapter.
 *
 * The core library stays dependency-free. This file imports only Express types,
 * so it disappears at runtime, and it can be imported from a normal Express
 * application without pulling Express into the cqrs core.
 */

import { randomUUID } from "node:crypto";
import type { Request, RequestHandler } from "express";
import { createRequestContext, runWithRequestContext } from "./context.ts";
import type { CqrsModule } from "./module.ts";
import type { ApplicationEventPublisher } from "./events.ts";
import type { CommandBus } from "./commandBus.ts";
import type { QueryBus } from "./queryBus.ts";

declare global {
  namespace Express {
    interface Request {
      cqrs: CqrsModule;
      commandBus: CommandBus;
      queryBus: QueryBus;
      events: ApplicationEventPublisher;
      requestId: string;
    }
  }
}

export interface AttachCqrsOptions {
  /** Derive the audit actor from the request. Defaults to null. */
  actor?: (req: Request) => string | null;
  /** Derive the request id. Defaults to `X-Request-Id` or a UUID. */
  requestId?: (req: Request) => string;
}

/** A module that is created lazily, after migrations or other startup work. */
export type CqrsModuleProvider = () => CqrsModule;

/**
 * Open one request context and expose the buses on `req`.
 *
 * Pass a module directly when it is already built, or a provider when the
 * application must create it lazily. The provider closes over the application's
 * own dependencies; the package does not need a global getter.
 */
export function attachCqrs(
  moduleOrProvider: CqrsModule | CqrsModuleProvider,
  options: AttachCqrsOptions = {},
): RequestHandler {
  const resolve = typeof moduleOrProvider === "function"
    ? moduleOrProvider
    : () => moduleOrProvider;

  return (req, res, next) => {
    const module = resolve();
    const requestId =
      options.requestId?.(req) ?? req.get("x-request-id") ?? randomUUID();
    const actor = options.actor?.(req) ?? null;

    req.cqrs = module;
    req.commandBus = module.commandBus;
    req.queryBus = module.queryBus;
    req.events = module.events;
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);

    runWithRequestContext(createRequestContext({ requestId, actor }), () => next());
  };
}

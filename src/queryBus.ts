/**
 * The query bus.
 *
 * Queries are read-only: no transaction, no audit rows and no events. They
 * still go through one registry so a controller never imports a handler and a
 * missing handler fails with the same message as a missing command handler.
 */

import { typeNameOf } from "./metadata.ts";
import { Query } from "./types.ts";
import type { Constructor, IQueryHandler } from "./types.ts";

export interface RegisteredQueryHandler {
  readonly query: Constructor;
  readonly handler: IQueryHandler<any, any>;
  readonly handlerClass: Constructor;
}

export class QueryBus {
  private handlers = new Map<Constructor, RegisteredQueryHandler>();

  registerHandlers(handlers: ReadonlyMap<Constructor, RegisteredQueryHandler>): void {
    this.handlers = new Map(handlers);
  }

  async send<R>(query: Query<R>): Promise<R> {
    if (typeof query !== "object" || query === null) {
      throw new TypeError("queryBus.send expects a query instance");
    }

    const registration = this.handlers.get(query.constructor as Constructor);
    if (!registration) {
      throw new Error(
        `No handler registered for query ${typeNameOf(query)}. ` +
          `Registered queries: [${[...this.handlers.keys()].map((ctor) => ctor.name).join(", ")}]`,
      );
    }

    return (await registration.handler.handle(query)) as R;
  }
}

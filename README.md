# express-prisma-cqrs

A small CQRS runtime for Express applications.

## Features

- TC39 class and method decorators
- Explicit dependency-injection container
- CommandBus and QueryBus
- Application events and policy listeners
- Optional audit repository
- Optional transaction runner
- AsyncLocalStorage request context
- Event-storming graph and optional static UI
- `attachCqrs` Express middleware
- No required Prisma dependency

## Install

```bash
npm install express-prisma-cqrs
```

## Normal Express app

```ts
import express from "express";
import {
  attachCqrs,
  initializeCqrs,
  registerEventStorming,
} from "express-prisma-cqrs";

const app = express();

const cqrs = initializeCqrs({
  components: APP_COMPONENTS,
});

app.use(attachCqrs(cqrs));

registerEventStorming(app);

app.listen(3000);
```

This gives you:

- `req.commandBus.send(...)` in routes
- `req.queryBus.send(...)` in routes
- `/event-storming`
- `/docs/commands`
- `/docs/command-flow`

The event-storming routes use the process-wide module from `getCqrsModule()`.
That is why this example uses `initializeCqrs`.

## `createCqrs` vs `initializeCqrs`

Use `createCqrs` when you do not need the global runtime:

```ts
const cqrs = createCqrs({
  components: APP_COMPONENTS,
});

app.use(attachCqrs(cqrs));
```

Use `initializeCqrs` when the package's event-storming routes must read the
module later:

```ts
const cqrs = initializeCqrs({
  components: APP_COMPONENTS,
});

app.use(attachCqrs(cqrs));
registerEventStorming(app);
```

`initializeCqrs` stores one module for the process. `createCqrs` creates a
module without that singleton.

## A command handler

```ts
import {
  Command,
  CommandHandler,
  DomainEvent,
  type CommandContext,
} from "express-prisma-cqrs";

class CreateNote extends Command<string> {
  constructor(readonly text: string) {
    super();
  }
}

class NoteCreated extends DomainEvent {
  constructor(readonly id: string) {
    super();
  }
}

@CommandHandler(CreateNote, {
  inject: [],
  emits: [NoteCreated],
})
class CreateNoteHandler {
  async handle(command: CreateNote, context: CommandContext): Promise<string> {
    const id = crypto.randomUUID();
    context.events.add(new NoteCreated(id));
    return id;
  }
}

export const APP_COMPONENTS = [CreateNoteHandler];
```

## Audit

Audit is optional. Without a repository, audit rows are discarded.

```ts
import type {
  AuditBatch,
  AuditEventRepository,
} from "express-prisma-cqrs";

class AuditRepository implements AuditEventRepository {
  async save(batch: AuditBatch): Promise<void> {
    // persist batch.records
  }
}

const cqrs = createCqrs({
  components: APP_COMPONENTS,
  auditEventRepository: new AuditRepository(),
});
```

The repository can use Prisma, SQL, a file, memory or an external service. The
package does not create a database client for you.

## Prisma transactions

The package defines a `TransactionRunner` port. Implement it with your Prisma
unit of work:

```ts
import { PrismaClient } from "@prisma/client";
import {
  attachCqrs,
  initializeCqrs,
  registerEventStorming,
} from "express-prisma-cqrs";

const prisma = new PrismaClient();
const unitOfWork = new PrismaUnitOfWork(prisma);

const cqrs = initializeCqrs({
  components: APP_COMPONENTS,
  auditEventRepository: new PrismaAuditRepository(prisma),
  transactionRunner: unitOfWork,
  configure: (container) => {
    container.registerValue(PrismaUnitOfWork, unitOfWork);
  },
});

app.use(attachCqrs(cqrs));
registerEventStorming(app);
```

`configure` is where application services and repositories enter the container.
It is not needed when every component depends only on other listed components.

## Authentication

If the application has auth middleware, call `registerEventStorming(app)` after
it and exempt the page's asset requests:

```ts
app.use(authMiddleware);
registerEventStorming(app);
```

A browser cannot attach an auth header to the diagram's own JS and CSS requests.
Exempt `/event-storming` and `/docs/command-flow`, or mount event-storming before
the auth middleware and accept that the graph endpoint is public.

## Route conflicts

The package mounts:

```text
/event-storming
/docs/commands
/docs/command-flow
```

If the application already owns `/docs`, pass a route registrar so the package
uses the application's existing documentation registry:

```ts
const docsRouter = createDocRouter("/docs");

registerEventStorming(app, {
  registerRoute: (path, config, handler) => {
    docsRouter.get(path, config as never, handler);
  },
});

app.use("/docs", docsRouter);
```

For a normal Express app with no existing docs layer, `registerEventStorming(app)`
is enough.

## Scripts

```bash
npm run build
npm run typecheck
```

## License

MIT

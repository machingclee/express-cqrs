# express-prisma-cqrs

A small CQRS runtime for Express applications.

## Features

- TC39 class and method decorators
- Explicit dependency-injection container
- `CommandBus` and `QueryBus`
- Application events and policy listeners
- Optional audit repository
- Optional transaction runner
- AsyncLocalStorage request context
- Event-storming graph and optional static UI
- `attachCqrs` Express middleware

## Install

```bash
npm install express-prisma-cqrs
```

## Minimal usage

```ts
import {
  attachCqrs,
  createCqrs,
} from "express-prisma-cqrs";

const cqrs = createCqrs({
  components: APP_COMPONENTS,
});

app.use(attachCqrs(cqrs));
```

A command handler:

```ts
@CommandHandler(CreateNote, {
  inject: [],
  emits: [NoteCreated],
})
class CreateNoteHandler {
  async handle(command: CreateNote, context: CommandContext) {
    context.events.add(new NoteCreated(command.id));
  }
}
```

An audit repository is optional:

```ts
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

Add `transactionRunner` and `configure` when handlers need a database unit of work.

## Event storming

The package ships the event-storming graph schemas, static assets and route adapter.

```ts
import { registerEventStorming } from "express-prisma-cqrs";

registerEventStorming(app);
```

The event-storming UI is served at `/event-storming`; `/docs/commands` returns the graph.

## License

MIT
# express-prisma-cqrs

# @machingclee/express-cqrs

A small CQRS runtime for Express applications.

## Table of contents

- [Features](#features)
- [Install](#install)
- [Agent skill](#agent-skill)
- [Normal Express app](#normal-express-app)
- [`createCqrs` vs `initializeCqrs`](#createcqrs-vs-initializecqrs)
- [A command handler](#a-command-handler)
- [Audit](#audit)
  - [What the library guarantees](#what-the-library-guarantees)
  - [What the repository must guarantee](#what-the-repository-must-guarantee)
  - [Record shape](#record-shape)
  - [Suggested table](#suggested-table)
  - [Example: Prisma](#example-prisma)
  - [Example: node-postgres](#example-node-postgres)
  - [Example: mysql2](#example-mysql2)
  - [Example: a test double](#example-a-test-double)
  - [Using the committed flag](#using-the-committed-flag)
  - [Wiring](#wiring)
- [Prisma transactions](#prisma-transactions)
- [Authentication](#authentication)
- [Route conflicts](#route-conflicts)
- [Scripts](#scripts)
- [License](#license)

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
- No ORM dependency: Prisma, TypeORM or raw SQL plug in through ports

## Install

```bash
npm install @machingclee/express-cqrs
```

## Agent skill

The workflow in this README is also packaged as an agent skill: <https://github.com/machingclee/my-skills/tree/main/express--cqrs>

Install it with the skills CLI, either into this project or for every project:

```bash
npx skills add https://github.com/machingclee/my-skills/tree/main/express--cqrs
npx skills add https://github.com/machingclee/my-skills/tree/main/express--cqrs -g
```

Add `-y` to skip the confirmation prompt, `-s` to pick the skill by name, and `-a claude-code` to target Claude Code only. Restart the session afterwards, because the skill list is read at startup.

## Normal Express app

```ts
import express from "express";
import {
  attachCqrs,
  initializeCqrs,
  registerEventStorming,
} from "@machingclee/express-cqrs";

const app = express();

const cqrs = initializeCqrs({
  components: APP_COMPONENTS,
});

// No-argument form uses getCqrsModule().
app.use(attachCqrs());

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

### The diagram itself

`/event-storming` serves a static bundle committed at `src/event-storming/public`.
It is built by the `event-storming/` project at the root of this repository — a
Vite app, kept out of `src/` so it never enters the package's TypeScript build:

```bash
npm run dev:event-storming     # HMR on http://localhost:5183, proxying /docs
npm run build:event-storming   # vite writes src/event-storming/public
npm run build                  # tsc + copy that folder into dist/
```

The page reads `GET /docs/commands` from whatever host app serves it, so it always
draws the running domain model; double-clicking a node copies its name, and
`▸ Schema (n)` opens a node's payload fields.

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

app.use(attachCqrs());
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
} from "@machingclee/express-cqrs";

class CreateNoteCommand extends Command<string> {
  constructor(readonly text: string) {
    super();
  }
}

class NoteCreatedEvent extends DomainEvent {
  constructor(readonly id: string) {
    super();
  }
}

@CommandHandler(CreateNoteCommand, {
  inject: [],
  emits: [NoteCreatedEvent],
})
class CreateNoteCommandHandler {
  async handle(command: CreateNoteCommand, context: CommandContext): Promise<string> {
    const id = crypto.randomUUID();
    context.events.add(new NoteCreatedEvent(id));
    return id;
  }
}

export const APP_COMPONENTS = [CreateNoteCommandHandler];
```

### Dispatch timing

`context.events.add(event)` dispatches inside the command transaction, so a
policy can still refuse the command by throwing.
`context.events.addTransactional(event)` dispatches after the commit, so it
cannot fail the write.

Timing belongs to the emission, not to the event class — the same event can be
immediate from one handler and deferred from another — so declare it on the
handler:

```ts
@CommandHandler(ArchiveDocumentCommand, {
  inject: [PrismaUnitOfWork],
  emits: [DocumentArchivedEvent, DocumentArchivedNoticeEvent],
  afterCommit: [DocumentArchivedNoticeEvent],
})
```

Every `afterCommit` entry must also be in `emits`. The handler then enqueues that
event with `addTransactional`; `add` throws, so the declaration and the call site
cannot disagree. `GET /docs/commands` reports the declaration as
`postCommitEmits`, the event-storming diagram puts a clock on that command → event
edge, and the event card carries a `Transactional` badge only when every handler
that emits it defers.

## Audit

Audit is optional. The bus records one row per command and one row per domain
event, then hands the rows to a repository that you own. Without a repository the
rows are discarded.

The port has exactly one method:

```ts
interface AuditEventRepository {
  save(batch: AuditBatch): Promise<void>;
}
```

The batch it receives:

```ts
interface AuditBatch {
  requestId: string;
  committed: boolean;
  records: AuditRecord[];
}
```

That is the whole contract. The bus itself talks to `AuditWriter`
(`write(batch)`), and `createCqrs` wraps your repository with
`AuditEventRepositoryWriter`, so `save` is the only method you implement.
`NoopAuditEventRepository` and `MemoryAuditEventRepository` exist for the two
edge cases: no audit store, and tests.

### What the library guarantees

Everything below is already done when `save` runs, so the repository stays a thin
writer and every consumer records the same trail.

- `save` is called at most once per top-level command, after the handler returns
  and after the command transaction has committed or rolled back. Nested
  commands do not produce a second call; their rows join the same batch.
- A batch is never empty.
- `records` are sorted by `order`, which starts at `0` for every request.
- `success` is already stamped. When the transaction rolled back, every record
  that was still successful becomes `success: false`, and `failureReason` is
  filled from the thrown error. A nested command that failed earlier keeps its
  own, more precise reason.
- `payload` is JSON text, already serialized and capped at 32 KB. `bigint`
  becomes a string, a value that cannot be serialized becomes
  `{"__serializationError":"..."}`, and a payload over the cap becomes
  `{"__truncated":true,"originalLength":51234,"preview":"..."}`.
- `failureReason` is compact text: `Name: message`, then up to 20 stack frames
  with framework and `node_modules` frames removed, capped at 4 KB.
- `createdAt` is epoch milliseconds, taken when the record was created.
- `requestId` is the id the `X-Request-Id` response header carries.
- `committed` says whether the business transaction committed.
- A throw from `save` is logged and swallowed. The HTTP response is unaffected,
  and the library does not retry.

Because the call happens after the transaction ends, the audit write is
best-effort: a crash between the commit and the write loses the batch. A
deployment that needs at-least-once audit writes an outbox row inside the command
transaction and forwards it afterwards. The port stays the same.

### What the repository must guarantee

- Persist every record of the batch, and write the batch atomically in one
  statement or one transaction. A partial batch leaves gaps in the request's
  sequence.
- Let failures propagate. The library logs them, and the command result already
  stands, so a lost audit write must not be silently swallowed twice.
- Keep the audit table independent of the business tables. An audit row outlives
  the document, folder or strip it describes, so a foreign key either refuses the
  row or deletes the history with the entity.
- Store `order` as `event_order`. Order is per request, not per row id, and the
  query order must match the order in which records were produced.
- Index `request_id` and `created_at`, and do not put a unique constraint on
  `request_id`, because one request writes several rows.
- Use a text type for `payload` and `failure_reason`. MySQL maps Prisma `String`
  to `VARCHAR(191)` by default, which truncates a payload; use `TEXT` or
  `LONGTEXT` there.
- Keep `created_at` in epoch milliseconds, the same unit the record carries,
  so every reader parses one format.

### Record shape

| Field           | Type             | Meaning                                             |
| --------------- | ---------------- | --------------------------------------------------- |
| `type`          | `string`         | class name, the same vocabulary the flow graph uses |
| `payload`       | `string`         | serialized JSON, capped at 32 KB                    |
| `order`         | `number`         | per-request position, starting at `0`               |
| `requestId`     | `string`         | one id shared by every row of a request             |
| `actor`         | `string \| null` | `null` until the application supplies an actor      |
| `createdAt`     | `number`         | epoch milliseconds                                  |
| `success`       | `boolean`        | already stamped, see above                          |
| `failureReason` | `string`         | `""` on success, compact text otherwise             |

### Suggested table

The SQLite shape used by the reference application. On PostgreSQL use
`bigserial` for `id`, `boolean` for `success` and `bigint` for `created_at`.
On MySQL use `BIGINT AUTO_INCREMENT`, `TINYINT(1)` and `LONGTEXT`.

```sql
CREATE TABLE event_audit (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id         TEXT    NOT NULL,
  event_type         TEXT    NOT NULL,
  payload            TEXT    NOT NULL,
  event_order        INTEGER NOT NULL,
  request_user_email TEXT,
  success            INTEGER NOT NULL,          -- 0 | 1
  failure_reason     TEXT    NOT NULL DEFAULT '',
  created_at         REAL    NOT NULL           -- epoch milliseconds
);

CREATE INDEX event_audit_request_id ON event_audit (request_id);
CREATE INDEX event_audit_created_at ON event_audit (created_at);
```

### Example: Prisma

One `createMany` per batch, which is already a single statement.

```ts
import type {
  AuditBatch,
  AuditEventRepository,
} from "@machingclee/express-cqrs";
import type { PrismaClient } from "@prisma/client";

export class PrismaAuditRepository implements AuditEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async save(batch: AuditBatch): Promise<void> {
    await this.prisma.event_audit.createMany({
      data: batch.records.map((record) => ({
        request_id: record.requestId,
        event_type: record.type,
        payload: record.payload,
        event_order: record.order,
        request_user_email: record.actor,
        success: record.success,
        failure_reason: record.failureReason,
        created_at: record.createdAt,
      })),
    });
  }
}
```

A project that uses the `prisma-client` generator with an `output` path
imports `PrismaClient` from that path instead of `@prisma/client`.

### Example: node-postgres

The tuple list is built from the batch, so the whole batch is one `INSERT` with
one parameter per value. Nothing is interpolated into the SQL text.

```ts
import { Pool } from "pg";
import type {
  AuditBatch,
  AuditEventRepository,
} from "@machingclee/express-cqrs";

const COLUMNS_PER_ROW = 8;

export function createPostgresAuditRepository(
  pool: Pool,
): AuditEventRepository {
  return {
    async save(batch: AuditBatch): Promise<void> {
      const values = batch.records.flatMap((record) => [
        record.requestId,
        record.type,
        record.payload,
        record.order,
        record.actor,
        record.success,
        record.failureReason,
        record.createdAt,
      ]);
      const tuples = batch.records.map((_, row) => {
        const placeholders = Array.from(
          { length: COLUMNS_PER_ROW },
          (_, column) => `$${row * COLUMNS_PER_ROW + column + 1}`,
        );
        return `(${placeholders.join(",")})`;
      });

      await pool.query(
        `INSERT INTO event_audit
           (request_id, event_type, payload, event_order,
            request_user_email, success, failure_reason, created_at)
         VALUES ${tuples.join(",")}`,
        values,
      );
    },
  };
}
```

### Example: mysql2

`mysql2` expands a nested array into the `VALUES` list, so the driver builds
the tuples and the repository only maps the fields.

```ts
import mysql from "mysql2/promise";
import type {
  AuditBatch,
  AuditEventRepository,
} from "@machingclee/express-cqrs";

export function createMySqlAuditRepository(
  pool: mysql.Pool,
): AuditEventRepository {
  return {
    async save(batch: AuditBatch): Promise<void> {
      await pool.query(
        `INSERT INTO event_audit
           (request_id, event_type, payload, event_order,
            request_user_email, success, failure_reason, created_at)
         VALUES ?`,
        [
          batch.records.map((record) => [
            record.requestId,
            record.type,
            record.payload,
            record.order,
            record.actor,
            record.success,
            record.failureReason,
            record.createdAt,
          ]),
        ],
      );
    },
  };
}
```

### Example: a test double

`MemoryAuditEventRepository` keeps every batch, which is what an assertion
needs. It copies each record, so a test cannot change recorded history by
accident.

```ts
import {
  MemoryAuditEventRepository,
  createCqrs,
} from "@machingclee/express-cqrs";

const audit = new MemoryAuditEventRepository();
const cqrs = createCqrs({
  components: APP_COMPONENTS,
  auditEventRepository: audit,
});

await cqrs.commandBus.send(new CreateNoteCommand("hello"));

const batch = audit.batches.at(-1);
console.log(batch?.records.map((record) => `${record.order}:${record.type}`));
// [ "0:CreateNoteCommand", "1:NoteCreatedEvent" ]
```

### Using the committed flag

`committed` separates a request that committed from one that rolled back, and the
records of a rolled-back request are already stamped `success: false`. A store
that only wants successful history can drop the batch, and a store that watches
failures can route it elsewhere.

```ts
import type {
  AuditBatch,
  AuditEventRepository,
  AuditRecord,
} from "@machingclee/express-cqrs";

interface AuditStore {
  append(records: AuditRecord[]): Promise<void>;
}

export function createRoutedAuditRepository(
  historyStore: AuditStore,
  failureStore: AuditStore,
): AuditEventRepository {
  return {
    async save(batch: AuditBatch): Promise<void> {
      const store = batch.committed ? historyStore : failureStore;
      await store.append(batch.records);
    },
  };
}
```

### Wiring

The same object works with both entry points. Pass it as
`auditEventRepository`, and the library wraps it for the bus.

```ts
const cqrs = createCqrs({
  components: APP_COMPONENTS,
  auditEventRepository: createPostgresAuditRepository(pool),
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
} from "@machingclee/express-cqrs";

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

app.use(attachCqrs());
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

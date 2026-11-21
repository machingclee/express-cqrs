/**
 * Audit trail port.
 *
 * The library records one row per command and one per domain event, but knows
 * nothing about storage. The application supplies an `AuditWriter`
 * (Prisma/SQLite today, any other database later) and decides the table and
 * column types. `MemoryAuditWriter` exists for tests and local experiments.
 */

export type AuditKind = "command" | "event";

export interface AuditRecord {
  kind: AuditKind;
  /** Command/event class name, the same vocabulary the flow graph uses. */
  type: string;
  /** JSON payload, already serialized and length-capped by the library. */
  payload: string;
  /** Per-request ordering, starting at zero. */
  order: number;
  requestId: string;
  /** `request_user_email` in the Java prototype; null until auth exists. */
  actor: string | null;
  createdAt: number;
  success: boolean;
  failureReason: string;
}

export interface AuditBatch {
  requestId: string;
  /** True when the top-level command's business transaction committed. */
  committed: boolean;
  records: AuditRecord[];
}

export interface AuditWriter {
  write(batch: AuditBatch): Promise<void>;
}

/**
 * The application-owned audit store.
 *
 * A consumer implements this class/interface and passes it to `createCqrs`.
 * The library wraps it as an `AuditWriter`, so the bus does not need to know
 * whether the rows go to Prisma, SQL, a file or memory.
 */
export interface AuditEventRepository {
  save(batch: AuditBatch): Promise<void>;
}

/** Adapts an application repository to the bus-facing writer port. */
export class AuditEventRepositoryWriter implements AuditWriter {
  constructor(private readonly repository: AuditEventRepository) {}

  write(batch: AuditBatch): Promise<void> {
    return this.repository.save(batch);
  }
}

/** Default when an application does not persist audit rows. */
export class NoopAuditWriter implements AuditWriter {
  async write(): Promise<void> {
    // Intentionally empty: the pipeline still works without an audit store.
  }
}

/** Repository-shaped no-op for applications without an audit database. */
export class NoopAuditEventRepository implements AuditEventRepository {
  async save(): Promise<void> {
    // Intentionally empty: audit is observation, not part of the command result.
  }
}

/** Keeps every batch in memory; for tests and for a dev server that wants a trail. */
export class MemoryAuditWriter implements AuditWriter {
  readonly batches: AuditBatch[] = [];

  async write(batch: AuditBatch): Promise<void> {
    this.batches.push({
      requestId: batch.requestId,
      committed: batch.committed,
      records: batch.records.map((record) => ({ ...record })),
    });
  }
}

/** Repository-shaped in-memory audit store for tests and examples. */
export class MemoryAuditEventRepository implements AuditEventRepository {
  readonly batches: AuditBatch[] = [];

  async save(batch: AuditBatch): Promise<void> {
    this.batches.push({
      requestId: batch.requestId,
      committed: batch.committed,
      records: batch.records.map((record) => ({ ...record })),
    });
  }
}

const MAX_PAYLOAD_LENGTH = 32 * 1024;
const MAX_FAILURE_LENGTH = 4 * 1024;

/**
 * Serialize a command or event for the audit row.
 *
 * `bigint` is stringified because `JSON.stringify` throws on it. A circular
 * structure or an oversized payload becomes a small, still-valid JSON object
 * instead of failing the command: the audit trail must never be the reason a
 * write is rejected.
 */
export function serializePayload(value: unknown, maxLength = MAX_PAYLOAD_LENGTH): string {
  let json: string;
  try {
    const serialized = JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    );
    json = serialized ?? JSON.stringify({ __undefined: true });
  } catch (error) {
    return JSON.stringify({ __serializationError: errorMessage(error) });
  }

  if (json.length <= maxLength) return json;
  return JSON.stringify({
    __truncated: true,
    originalLength: json.length,
    preview: json.slice(0, maxLength),
  });
}

/**
 * Compact failure reason for `failure_reason`.
 *
 * The Java prototype keeps the exception plus application frames and drops
 * framework/servlet noise. The Node equivalent drops `node_modules` and Node
 * internals, which leaves the frames that belong to this application.
 */
export function formatFailure(error: unknown, maxLength = MAX_FAILURE_LENGTH): string {
  if (!(error instanceof Error)) return truncate(errorMessage(error), maxLength);

  const lines: string[] = [`${error.name}: ${error.message}`];
  for (const line of error.stack?.split("\n").slice(1) ?? []) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("at ")) continue;
    if (isInternalFrame(trimmed)) continue;
    lines.push(trimmed);
    if (lines.length >= 20) break;
  }
  if (error.cause instanceof Error) {
    lines.push(`Caused by: ${error.cause.name}: ${error.cause.message}`);
  }
  return truncate(lines.join("\n"), maxLength);
}

function isInternalFrame(frame: string): boolean {
  return (
    frame.includes("node:internal") ||
    frame.includes("node_modules") ||
    frame.includes("(bun:") ||
    frame.includes("async_hooks")
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function truncate(text: string, maxLength: number): string {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`;
}

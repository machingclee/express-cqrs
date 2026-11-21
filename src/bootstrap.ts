/**
 * The small public entrypoint for applications that do not need to assemble a
 * container by hand.
 *
 * Required input:
 * - the decorated component list of one bounded context.
 *
 * Optional inputs:
 * - an application-owned `AuditEventRepository`; without one, audit rows are
 *   discarded by a no-op repository;
 * - a transaction runner (Prisma, TypeORM, a test double);
 * - a `configure` callback for app services and repositories that handlers
 *   inject.
 *
 * A project with no audit database can omit `auditEventRepository` and still
 * use commands, queries, events, policies and the flow graph.
 */

import type { AuditEventRepository } from "./audit.ts";
import { AuditEventRepositoryWriter, NoopAuditEventRepository } from "./audit.ts";
import { Container } from "./container.ts";
import { AUDIT_WRITER, TRANSACTION_RUNNER, createCqrsModule } from "./module.ts";
import type { CqrsModule } from "./module.ts";
import type { Constructor } from "./types.ts";
import type { TransactionRunner } from "./unitOfWork.ts";

export interface CqrsOptions {
  /** Every decorated handler, policy and service in the bounded context. */
  components: Constructor[];
  /** The application's audit store. Omit it when there is no audit database. */
  auditEventRepository?: AuditEventRepository;
  /** Optional transaction adapter. Without one, commands run without a transaction. */
  transactionRunner?: TransactionRunner;
  /**
   * Register app-specific providers that handlers inject, such as a Prisma unit
   * of work or repositories. Keep database code out of this package.
   */
  configure?: (container: Container) => void;
  /** Defaults to true for compiled builds. Set false only for local experiments. */
  strictDomainTypes?: boolean;
}

export function createCqrs(options: CqrsOptions): CqrsModule {
  const container = new Container();

  if (options.transactionRunner) {
    container.registerValue(TRANSACTION_RUNNER, options.transactionRunner);
  }

  container.registerValue(
    AUDIT_WRITER,
    new AuditEventRepositoryWriter(
      options.auditEventRepository ?? new NoopAuditEventRepository(),
    ),
  );

  options.configure?.(container);

  return createCqrsModule({
    container,
    components: options.components,
    strictDomainTypes: options.strictDomainTypes ?? true,
  });
}

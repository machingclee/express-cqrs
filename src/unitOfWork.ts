/**
 * Transaction port used by the command bus.
 *
 * The bus only needs to know whether a transaction is already active (nested
 * command) and how to open one. It deliberately knows nothing about Prisma,
 * SQL or connection scopes; the application supplies an implementation whose
 * `run` also makes the transactional client available to its repositories.
 */
export interface TransactionRunner {
  run<T>(fn: () => Promise<T>): Promise<T>;
  isActive(): boolean;
}

/**
 * Default runner for applications/tests without a database. Commands still
 * run, they simply are not wrapped in a transaction.
 */
export class NoTransactionRunner implements TransactionRunner {
  run<T>(fn: () => Promise<T>): Promise<T> {
    return fn();
  }

  isActive(): boolean {
    return false;
  }
}

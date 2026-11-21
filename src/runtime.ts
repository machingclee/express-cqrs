/**
 * Process-wide domain module singleton.
 *
 * The application supplies every dependency through `createCqrs`; this module
 * only owns startup ordering. It imports no Express, Prisma, context or
 * infrastructure code.
 */

import {
  createCqrs,
  type CqrsOptions,
} from "./bootstrap.ts";
import type { CqrsModule } from "./module.ts";

let singleton: CqrsModule | undefined;

export function initializeCqrs(options: CqrsOptions): CqrsModule {
  if (singleton) return singleton;
  singleton = createCqrs(options);
  return singleton;
}

export function getCqrsModule(): CqrsModule {
  if (!singleton) {
    throw new Error(
      "CQRS module is not initialized; call initializeCqrs(...) before accepting requests",
    );
  }
  return singleton;
}

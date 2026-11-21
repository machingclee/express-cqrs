/**
 * Public CQRS package entrypoint.
 *
 * Only the supported consumer API is exported here. Internal metadata,
 * container and flow helpers stay private to the package.
 */

export {
  Actor,
  BoundedContext,
  CommandHandler,
  EventListener,
  Invariant,
  Payload,
  Policy,
  QueryHandler,
  Service,
  Transactional,
} from "./decorators.ts";
export type {
  CommandHandlerOptions,
  EventListenerOptions,
  PolicyOptions,
  QueryHandlerOptions,
  ServiceOptions,
  TransactionalOptions,
} from "./decorators.ts";

export { Command, DomainEvent, Query } from "./types.ts";
export type {
  AbstractConstructor,
  CommandResult,
  Constructor,
  EventClass,
  ICommandHandler,
  IQueryHandler,
  MaybePromise,
  QueryResult,
} from "./types.ts";

export { Container, InjectionToken } from "./container.ts";
export type { Token } from "./container.ts";

export {
  createRequestContext,
  currentContext,
  currentRequestId,
  runWithRequestContext,
} from "./context.ts";
export type { RequestContext } from "./context.ts";

export { ApplicationEventPublisher, EventQueue } from "./events.ts";
export type { CommandContext, DispatchTiming, EventWrapper } from "./events.ts";

export { MemoryAuditWriter } from "./audit.ts";
export type {
  AuditBatch,
  AuditEventRepository,
  AuditRecord,
  AuditWriter,
} from "./audit.ts";

export type { TransactionRunner } from "./unitOfWork.ts";

export { CommandBus } from "./commandBus.ts";
export { QueryBus } from "./queryBus.ts";

export { AUDIT_WRITER, TRANSACTION_RUNNER, createCqrsModule } from "./module.ts";
export type { CqrsModule, CqrsModuleOptions } from "./module.ts";

export { createCqrs } from "./bootstrap.ts";
export type { CqrsOptions } from "./bootstrap.ts";

export { attachCqrs } from "./express.ts";
export type { AttachCqrsOptions, CqrsModuleProvider } from "./express.ts";

export { initializeCqrs, getCqrsModule } from "./runtime.ts";

export {
  EVENT_STORMING_URL_PATH,
  eventStormingUrl,
  registerEventStorming,
} from "./event-storming/router.ts";
export type {
  EventStormingRouteConfig,
  EventStormingRouteRegistrar,
  EventStormingUrl,
  RegisterEventStormingOptions,
} from "./event-storming/router.ts";

export { typeNameOf } from "./metadata.ts";

export type {
  CommandFlow,
  CqrsFlow,
  EventFlow,
  InvariantFlow,
  PolicyFlow,
  QueryFlow,
} from "./flow.ts";

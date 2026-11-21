/**
 * Decorator metadata storage.
 *
 * Metadata is attached to the class function (or the method function) under a
 * symbol key instead of a WeakMap so that a class and its metadata can never
 * drift apart, even if this module is loaded twice. Symbols survive the
 * bundler; property names on the metadata objects are read through the same
 * code that writes them, so minification cannot break them.
 */

import type { Token } from "./container.ts";
import type { Constructor, EventClass } from "./types.ts";

export type TransactionMode = "required" | "none";

export interface CommandHandlerMeta {
  command: Constructor;
  inject: Token[];
  emits: Constructor[];
}

export interface QueryHandlerMeta {
  query: Constructor;
  inject: Token[];
}

export interface EventListenerMeta {
  event: EventClass;
  sends: Constructor[];
}

/**
 * The fields a command, query or event carries.
 *
 * TypeScript erases constructor parameter types, so this cannot be read off the
 * class at runtime — it is declared with `@Payload(...)` instead.
 */
export interface PayloadMeta {
  /** `field: type` (or `field?: type` when the field is optional). */
  fields: Record<string, string>;
  /** Named nested shapes, so a diagram can open one level of a `field: Type`. */
  dtos?: Record<string, Record<string, string>>;
}

export interface CqrsClassMeta {
  payload?: PayloadMeta;
  actors?: string[];
  boundedContext?: string;
  service?: { inject: Token[] };
  policy?: {
    inject: Token[];
    /**
     * Keep the policy out of the flow graph. It is still instantiated and still
     * receives its events — only the diagram ignores it, which is what a
     * development-only listener wants.
     */
    excludeFromFlow?: boolean;
  };
  commandHandler?: CommandHandlerMeta;
  queryHandler?: QueryHandlerMeta;
  transaction?: { mode: TransactionMode };
}

export interface MethodMeta {
  eventListener?: EventListenerMeta;
  invariants?: string[];
}

const CLASS_META = Symbol.for("cqrs:class-meta");
const METHOD_META = Symbol.for("cqrs:method-meta");

export function ensureClassMeta(target: Function): CqrsClassMeta {
  const existing = (target as { [CLASS_META]?: CqrsClassMeta })[CLASS_META];
  if (existing) return existing;

  const meta: CqrsClassMeta = {};
  Object.defineProperty(target, CLASS_META, { value: meta, configurable: true });
  return meta;
}

export function classMetaOf(target: Function): CqrsClassMeta | undefined {
  return (target as { [CLASS_META]?: CqrsClassMeta })[CLASS_META];
}

export function ensureMethodMeta(target: Function): MethodMeta {
  const existing = (target as { [METHOD_META]?: MethodMeta })[METHOD_META];
  if (existing) return existing;

  const meta: MethodMeta = {};
  Object.defineProperty(target, METHOD_META, { value: meta, configurable: true });
  return meta;
}

export function methodMetaOf(target: Function): MethodMeta | undefined {
  return (target as { [METHOD_META]?: MethodMeta })[METHOD_META];
}

/**
 * True when the class carries at least one domain annotation.
 *
 * Besides describing the class for the flow graph, a class decorator is what
 * makes Bun's minifier preserve `Function.name` (it emits a name-restoring
 * helper for decorated classes). Audit rows and flow nodes use those names, so
 * a command/query/event without a domain annotation would silently acquire a
 * mangled `event_type` in the compiled sidecar. `strictDomainTypes` turns that
 * into a startup error.
 */
export function hasDomainMetadata(target: Function): boolean {
  const meta = classMetaOf(target);
  return meta?.actors !== undefined || meta?.boundedContext !== undefined;
}

/** Class name for audit rows, flow nodes and error messages. */
export function typeNameOf(value: object | Function): string {
  if (typeof value === "function") return value.name || "<anonymous class>";
  const ctor = (value as { constructor?: Function }).constructor;
  return ctor?.name || "<anonymous class>";
}

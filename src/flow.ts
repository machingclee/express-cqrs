/**
 * Shapes returned by the event-storming flow endpoint.
 *
 * The Java prototype builds this graph by scanning bytecode (controllers,
 * handlers, policies) and reflecting DTO fields. The Node variant builds it
 * from the decorator metadata instead: a handler declares the events it emits
 * and a policy declares the commands it sends, so the graph is complete at
 * boot without source analysis.
 */

export interface CommandFlow {
  name: string;
  handler: string;
  context: string;
  actors: string[];
  transaction: "required" | "none";
  emits: string[];
  /** What the client supplies: `field: type`, from `@Payload(...)`. */
  payload: Record<string, string>;
}

export interface QueryFlow {
  name: string;
  handler: string;
  context: string;
  actors: string[];
  /** The query's parameters: `field: type`, from `@Payload(...)`. */
  payload: Record<string, string>;
}

/**
 * One `@EventListener` method of a policy: the event it reacts to, the commands
 * that reaction dispatches, and the `@Invariant` rules on that method.
 */
export interface PolicyListenerFlow {
  event: string;
  sends: string[];
  rules: string[];
}

export interface PolicyFlow {
  name: string;
  listensTo: string[];
  sends: string[];
  /**
   * One entry per `@EventListener` method, in declaration order.
   *
   * `listensTo` and `sends` are the unions of these reactions, so on their own
   * they cannot say *which* event leads to *which* command. This list is the
   * pairing: a policy that listens to two events gets two entries, and the
   * event-storming diagram draws a rule row per routing from it. A policy with
   * a single listener may omit it and older payloads do; consumers then fall
   * back to the unions.
   */
  listeners?: PolicyListenerFlow[];
}

export interface EventFlow {
  name: string;
  context: string;
  /** What the event carries: `field: type`, from `@Payload(...)`. */
  payload: Record<string, string>;
}

/** A business rule attached to a policy listener, explaining why it routes onward. */
export interface InvariantFlow {
  component: string;
  method: string;
  rules: string[];
}

export interface CqrsFlow {
  commands: CommandFlow[];
  queries: QueryFlow[];
  policies: PolicyFlow[];
  events: EventFlow[];
  invariants: InvariantFlow[];
  /**
   * Named nested shapes that payload types may refer to, gathered from every
   * `@Payload(fields, dtos)` on the graph.
   */
  dtos: Record<string, Record<string, string>>;
}

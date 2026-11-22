import type { PolicyModel } from "./types";

/**
 * The policy card's invariant blocks, and the reactions its edges come from.
 *
 * `echarge-event-storming-component` gives every invariant block its own pair of
 * React Flow handles (`t-0` / `s-0`, `t-1` / `s-1`, …) and mints one edge per
 * routing, not one per event name. That distinction matters as soon as a policy
 * reacts to one event twice — two `@EventListener` methods on the same event are
 * two reactions, and each must reach its own row.
 *
 * This module is that model, shared by the layout (which mints the edges) and
 * `PolicyNode` (which renders the rows), so a row's index and its handle id
 * cannot drift apart.
 */

export interface PolicyFlowView {
  fromEvent: string | null;
  toCommand: string | null;
  invariant: string;
  /**
   * The reaction this row belongs to. Rows of one reaction share it, so a
   * listener whose rules occupy three rows still yields one arrow. It is not
   * rendered; only edge minting reads it.
   */
  group: string;
}

/** Handle ids, in one place: `PolicyNode` renders them, the layout targets them. */
export const policyHandles = {
  target: (row: number) => `t-${row}`,
  source: (row: number) => `s-${row}`,
  /**
   * Vertical-centre anchors, used by edges no row names — a wildcard
   * subscription is to every event, not to one reaction — and kept invisible so
   * the card does not suggest a routing row that is not there.
   */
  targetCentre: "t-centre",
  sourceCentre: "s-centre",
} as const;

/**
 * A policy card lists one block per invariant: the rule text, then the
 * event → command routing that rule justifies. Policies from the decorator
 * shape declare listeners/dispatches without rule text, so each of those pairs
 * becomes a block of its own.
 *
 * The order is the order the blocks are rendered in, so `index` is the row.
 */
export function policyFlows(policy: PolicyModel): PolicyFlowView[] {
  if (policy.links.length > 0) {
    return policy.links.map((link, index) => ({
      fromEvent: link.fromEvent,
      toCommand: link.toCommand,
      invariant: link.invariant ?? "",
      // A payload that names its listener methods groups the rows of one
      // reaction together; an explicit flow is a reaction of its own.
      group: link.listener === undefined ? `flow:${index}` : `listener:${link.listener}`,
    }));
  }
  if (policy.rules.length > 0) {
    return policy.rules.map((rule) => {
      const fromEvent = policy.listensTo.find((event) => event !== "DomainEvent") ?? null;
      const toCommand = policy.sends[0] ?? null;
      return {
        fromEvent,
        toCommand,
        invariant: rule,
        // Without per-listener data every rule is tagged with the same routing;
        // one arrow is all the card can honestly claim.
        group: `route:${fromEvent ?? ""}->${toCommand ?? ""}`,
      };
    });
  }
  const fromEvent = policy.listensTo.find((event) => event !== "DomainEvent") ?? null;
  const toCommand = policy.sends[0] ?? null;
  return [
    {
      fromEvent,
      toCommand,
      invariant: policy.wildcard ? "Listens to every domain event." : "",
      group: `route:${fromEvent ?? ""}->${toCommand ?? ""}`,
    },
  ];
}

export interface PolicyRouting {
  /** One entry per reaction an event triggers, at the row that names that event. */
  incoming: { event: string; row: number }[];
  /** One entry per reaction and dispatched command, at the row that names it. */
  outgoing: { command: string; row: number }[];
}

/**
 * The edges a policy should receive and send.
 *
 * This is deliberately not derived from `policy.listensTo` / `policy.sends`:
 * those are unions, so two listeners on one event would collapse into a single
 * arrow and the second row would be unreachable. Each reaction contributes one
 * incoming edge (however many rules its rows carry) and one outgoing edge per
 * distinct command it dispatches.
 */
export function policyRouting(flows: PolicyFlowView[]): PolicyRouting {
  const incoming: PolicyRouting["incoming"] = [];
  const outgoing: PolicyRouting["outgoing"] = [];
  const seenEvents = new Set<string>();
  const seenCommands = new Set<string>();

  flows.forEach((flow, row) => {
    if (flow.fromEvent && !seenEvents.has(flow.group)) {
      seenEvents.add(flow.group);
      incoming.push({ event: flow.fromEvent, row });
    }
    const commandKey = `${flow.group}::${flow.toCommand}`;
    if (flow.toCommand && !seenCommands.has(commandKey)) {
      seenCommands.add(commandKey);
      outgoing.push({ command: flow.toCommand, row });
    }
  });

  return { incoming, outgoing };
}

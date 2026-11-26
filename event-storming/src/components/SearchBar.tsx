import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { nodeId, type LayoutTab } from "../flow/layout";
import { buildTokenRegex, matchesQuery, queryTokens } from "../flow/search";
import { WILDCARD_EVENT, type FlowGraph } from "../flow/types";

/**
 * The search box of `echarge-event-storming-component`, ported to this app's
 * graph.
 *
 * The reference shows its matches in a popover right under the input rather
 * than only dimming the drawing: type `Create Folder`, read the list, press
 * Enter (or click) and the canvas jumps to the card. This is that behaviour:
 *
 *   - every space in a query means "anything in between" (`Create Folder`
 *     becomes `/Create.*Folder/i`), matching names, contexts, actors, payload
 *     fields, routes and policy rules;
 *   - the popover lists label, context/route, routing for a rule, and the kind;
 *   - `↑` / `↓` move, `Enter` opens, `Esc` clears, `/` focuses the box.
 *
 * Typing also keeps the graph's own search dimming (see `flow/focus.ts`), so
 * the matches are visible on the canvas as well as in the list.
 */

const MAX_RESULTS = 12;
const LIST_ID = "flow-search-results";

type SearchKind =
  | "command"
  | "event"
  | "policy"
  | "rule"
  | "query"
  | "result"
  | "context"
  | "actor";

const KIND_COLOR: Record<SearchKind, string> = {
  command: "#2563eb",
  event: "#f97316",
  policy: "#a78bfa",
  rule: "#8b5cf6",
  query: "#06b6d4",
  result: "#14b8a6",
  context: "#64748b",
  actor: "#eab308",
};

export interface SearchItem {
  /** Stable React key; one node can produce several rows (its rules). */
  key: string;
  label: string;
  sub?: string;
  /** Routing for a policy rule: `Event → Policy → Command`. */
  trigger?: string;
  /** Actors, emitters or senders shown as a small third line. */
  meta?: string;
  kind: SearchKind;
  /** The card to select when this row is chosen. */
  nodeId: string;
  /** The tab the card lives on. */
  tab: LayoutTab;
  /** Everything a query is tested against, joined into one string. */
  haystack: string;
}

/** `GET /docs/commands` has more field names than the card shows; search them all. */
function payloadTerms(payload: Record<string, unknown> | undefined): string[] {
  if (!payload) return [];
  const terms: string[] = [];
  for (const [field, type] of Object.entries(payload)) {
    terms.push(field, String(type ?? ""));
  }
  return terms;
}

function httpLine(method: string | undefined, path: string | undefined): string | undefined {
  return method && path ? `${method} ${path}` : undefined;
}

function addItem(
  items: SearchItem[],
  seed: Omit<SearchItem, "haystack">,
  extra: Array<string | undefined> = [],
): void {
  const haystack = [
    seed.label,
    seed.sub ?? "",
    seed.trigger ?? "",
    seed.meta ?? "",
    ...extra.filter((part): part is string => typeof part === "string" && part.length > 0),
  ].join(" ");
  items.push({ ...seed, haystack });
}

/**
 * One row per thing a reader would look up: commands, events, policies, each
 * policy rule, queries, query results, context boxes and actors — the same
 * breadth as the reference's command/event/policy/query/entity/service list.
 */
export function buildSearchItems(graph: FlowGraph): SearchItem[] {
  const items: SearchItem[] = [];

  for (const command of graph.commands) {
    const actors = command.actors ?? [];
    addItem(
      items,
      {
        key: `command:${command.name}`,
        label: command.name,
        sub: httpLine(command.httpMethod, command.path) ?? command.context,
        meta: actors.length > 0 ? `👤 ${actors.join(", ")}` : undefined,
        kind: "command",
        nodeId: nodeId.command(command.name),
        tab: "commands",
      },
      [
        command.context,
        command.handler,
        command.summary,
        command.httpMethod,
        command.path,
        ...actors,
        ...command.emits,
        ...payloadTerms(command.payload),
      ],
    );
  }

  for (const event of graph.events) {
    addItem(
      items,
      {
        key: `event:${event.name}`,
        label: event.name,
        sub: event.context,
        meta: event.external
          ? "external"
          : event.emittedBy.length > 0
            ? `emitted by ${event.emittedBy.join(", ")}`
            : undefined,
        kind: "event",
        nodeId: nodeId.event(event.name),
        tab: "commands",
      },
      [
        event.context,
        ...event.emittedBy,
        ...event.listenedBy,
        ...payloadTerms(event.payload),
      ],
    );
  }

  for (const policy of graph.policies) {
    const listensTo = policy.listensTo.filter((name) => name !== WILDCARD_EVENT);
    const listening = policy.wildcard
      ? "every domain event"
      : listensTo.length > 0
        ? listensTo.join(", ")
        : undefined;
    addItem(
      items,
      {
        key: `policy:${policy.name}`,
        label: policy.name,
        sub: listening ? `listens to ${listening}` : undefined,
        meta: policy.sends.length > 0 ? `sends ${policy.sends.join(", ")}` : undefined,
        kind: "policy",
        nodeId: nodeId.policy(policy.name),
        tab: "commands",
      },
      [
        ...policy.listensTo,
        ...policy.sends,
        ...policy.rules,
        ...policy.links.flatMap((link) => [
          link.fromEvent ?? "",
          link.toCommand ?? "",
          link.invariant ?? "",
        ]),
      ],
    );

    // Each invariant is its own row, like the reference: the rule text is what
    // a reader remembers, and the trigger chip says where it fires.
    const linkedRules = new Set<string>();
    policy.links.forEach((link, index) => {
      const rule = (link.invariant ?? "").trim();
      if (!rule) return;
      linkedRules.add(rule);
      const trigger = [link.fromEvent, policy.name, link.toCommand].filter(Boolean).join(" → ");
      addItem(
        items,
        {
          key: `policy:${policy.name}:rule:${index}`,
          label: rule,
          sub: policy.name,
          trigger: trigger.length > 0 ? trigger : undefined,
          kind: "rule",
          nodeId: nodeId.policy(policy.name),
          tab: "commands",
        },
        [link.fromEvent ?? "", link.toCommand ?? "", link.invariant ?? ""],
      );
    });
    // Older payloads carry rules without listener-level routing.
    policy.rules.forEach((raw, index) => {
      const rule = raw.trim();
      if (!rule || linkedRules.has(rule)) return;
      addItem(
        items,
        {
          key: `policy:${policy.name}:rule:plain:${index}`,
          label: rule,
          sub: policy.name,
          kind: "rule",
          nodeId: nodeId.policy(policy.name),
          tab: "commands",
        },
        [rule],
      );
    });
  }

  for (const query of graph.queries) {
    const actors = query.actors ?? [];
    addItem(
      items,
      {
        key: `query:${query.name}`,
        label: query.name,
        sub: httpLine(query.httpMethod, query.path) ?? query.context,
        meta: actors.length > 0 ? `👤 ${actors.join(", ")}` : undefined,
        kind: "query",
        nodeId: nodeId.query(query.name),
        tab: "queries",
      },
      [
        query.context,
        query.handler,
        query.summary,
        query.httpMethod,
        query.path,
        query.resultName,
        ...actors,
        ...payloadTerms(query.payload),
        ...payloadTerms(query.resultPayload),
      ],
    );

    if (query.resultName || Object.keys(query.resultPayload ?? {}).length > 0) {
      addItem(
        items,
        {
          key: `result:${query.name}`,
          label: query.resultName || "Result",
          sub: `${query.name} result`,
          kind: "result",
          nodeId: nodeId.result(query.name),
          tab: "queries",
        },
        [query.name, ...payloadTerms(query.resultPayload)],
      );
    }
  }

  for (const context of graph.contexts) {
    const hasCommands =
      context.commands.length > 0 ||
      context.events.length > 0 ||
      context.policies.length > 0;
    const hasQueries = context.queries.length > 0;
    if (!hasCommands && !hasQueries) continue;

    addItem(
      items,
      {
        key: `context:${context.name}`,
        label: context.name,
        sub: "bounded context",
        kind: "context",
        nodeId: nodeId.group(context.name),
        tab: hasCommands ? "commands" : "queries",
      },
      [context.label, "bounded context"],
    );

    // An actor node is drawn per context, on the tab its command/query lives on.
    const actorTabs = new Map<string, LayoutTab>();
    for (const command of context.commands) {
      for (const actor of command.actors) {
        if (!actorTabs.has(actor)) actorTabs.set(actor, "commands");
      }
    }
    for (const query of context.queries) {
      for (const actor of query.actors) {
        if (!actorTabs.has(actor)) actorTabs.set(actor, "queries");
      }
    }
    for (const [actor, tab] of actorTabs) {
      addItem(
        items,
        {
          key: `actor:${context.name}:${actor}`,
          label: actor,
          sub: context.name,
          kind: "actor",
          nodeId: nodeId.actor(context.name, actor),
          tab,
        },
        [context.name],
      );
    }
  }

  return items.sort(
    (a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) ||
      a.key.localeCompare(b.key),
  );
}

/**
 * Wrap the query's literal tokens in `<mark>`, merging overlaps. Matching is
 * the token regex, so the highlight is deliberately per-token: `Create Folder`
 * marks both halves of `CreateFolderCommand`.
 */
function highlight(text: string, query: string): ReactNode {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return text;

  const lower = text.toLowerCase();
  const intervals: Array<[number, number]> = [];
  for (const token of tokens) {
    const needle = token.toLowerCase();
    let from = 0;
    while (from <= lower.length) {
      const index = lower.indexOf(needle, from);
      if (index === -1) break;
      intervals.push([index, index + needle.length]);
      from = index + 1;
    }
  }
  if (intervals.length === 0) return text;

  intervals.sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [intervals[0]];
  for (let index = 1; index < intervals.length; index += 1) {
    const previous = merged[merged.length - 1];
    const current = intervals[index];
    if (current[0] <= previous[1]) previous[1] = Math.max(previous[1], current[1]);
    else merged.push(current);
  }

  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(<mark key={`${start}-${end}`}>{text.slice(start, end)}</mark>);
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

interface SearchBarProps {
  graph: FlowGraph | null;
  value: string;
  onChange: (value: string) => void;
  onNavigate: (nodeId: string, tab: LayoutTab) => void;
}

export default function SearchBar({ graph, value, onChange, onNavigate }: SearchBarProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => (graph ? buildSearchItems(graph) : []), [graph]);

  const results = useMemo(() => {
    const regex = buildTokenRegex(value);
    if (!regex) return [];
    const normalized = queryTokens(value).join(" ").toLowerCase();
    const matched = items.filter((item) => matchesQuery(item.haystack, regex));
    // An exact name first, then a name that matches the query itself, then a
    // card that merely has the words in its context, route or payload —
    // otherwise "PDF Note Management" would return twelve commands and never
    // the context box. Ties keep the alphabetical order `buildSearchItems`
    // established.
    const rankOf = (item: SearchItem): number => {
      if (item.label.toLowerCase() === normalized) return 0;
      return regex.test(item.label) ? 1 : 2;
    };
    return matched
      .map((item) => ({ item, rank: rankOf(item) }))
      .sort(
        (a, b) =>
          a.rank - b.rank ||
          a.item.label.localeCompare(b.item.label, undefined, { sensitivity: "base" }),
      )
      .slice(0, MAX_RESULTS)
      .map(({ item }) => item);
  }, [items, value]);

  const safeIndex = results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);
  const showPopover = open && value.trim().length > 0;

  // A new query starts at the top; a shorter list clamps the cursor.
  useEffect(() => {
    setActiveIndex(0);
  }, [value]);
  useEffect(() => {
    setActiveIndex((index) => Math.min(index, Math.max(results.length - 1, 0)));
  }, [results.length]);

  // "/" focuses the box, as in the reference (and this app before it).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable === true;
      if (event.key === "/" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Clicking anywhere else closes the list but keeps the query.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!showPopover) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${safeIndex}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [safeIndex, showPopover]);

  const choose = useCallback(
    (item: SearchItem) => {
      onNavigate(item.nodeId, item.tab);
      setOpen(false);
      inputRef.current?.blur();
    },
    [onNavigate],
  );

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      onChange("");
      inputRef.current?.blur();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      if (results.length > 0) setActiveIndex((index) => (index + 1) % results.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length > 0) {
        setActiveIndex((index) => (index - 1 + results.length) % results.length);
      }
      return;
    }
    if (event.key === "Enter") {
      const item = results[safeIndex];
      if (item) {
        event.preventDefault();
        choose(item);
      }
      return;
    }
    if (event.key === "Tab") setOpen(false);
  };

  return (
    <div className="flow-search" ref={rootRef}>
      <input
        ref={inputRef}
        className="flow-search-input"
        value={value}
        placeholder="Search names, payload fields…  ( / )"
        disabled={!graph}
        role="combobox"
        aria-expanded={showPopover}
        aria-controls={LIST_ID}
        aria-autocomplete="list"
        aria-activedescendant={
          showPopover && results[safeIndex] ? `${LIST_ID}-${safeIndex}` : undefined
        }
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onFocus={() => {
          if (value.trim()) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />

      {showPopover && (
        <div className="search-popover" id={LIST_ID} role="listbox" ref={listRef}>
          {results.length === 0 ? (
            <div className="search-popover-empty">
              No match for “{value.trim()}”
            </div>
          ) : (
            results.map((item, index) => (
              <div
                key={item.key}
                id={`${LIST_ID}-${index}`}
                data-index={index}
                role="option"
                aria-selected={index === safeIndex}
                className={`search-result${index === safeIndex ? " is-active" : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(item)}
              >
                <span
                  className="search-result-dot"
                  style={{ background: KIND_COLOR[item.kind] }}
                  aria-hidden
                />
                <span className="search-result-body">
                  <span className="search-result-label">{highlight(item.label, value)}</span>
                  {item.sub && (
                    <span className="search-result-sub">{highlight(item.sub, value)}</span>
                  )}
                  {item.trigger && (
                    <span className="search-result-trigger">{item.trigger}</span>
                  )}
                  {item.meta && (
                    <span className="search-result-meta">{item.meta}</span>
                  )}
                </span>
                <span className="search-result-kind">{item.kind}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

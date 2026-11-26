import type { Edge, Node } from "@xyflow/react";
import { buildTokenRegex, matchesQuery } from "./search";

/**
 * Focus — the search's highlight and the click-to-inspect dimming.
 *
 * Applied to the laid-out graph rather than inside the layout, for one concrete
 * reason: the nodes are draggable. Rebuilding the layout on a keystroke or a
 * click would snap every card back to its computed position, so highlighting is
 * a pure transform over the current nodes and their user-set positions.
 *
 * Two ways into focus, as in `echarge-event-storming-component`:
 *
 *   - searching dims everything that neither matches nor touches a match;
 *   - clicking a card keeps that card and the cards one edge away — its sources
 *     on the left and its targets on the right — and dims the rest.
 *
 * Clicking a bounded-context box focuses the whole context plus whatever its
 * cards reach, which is the reference's group behaviour.
 */

export interface FocusOptions {
  /** Free-text search; matches and their direct neighbours stay lit. */
  search: string;
  /**
   * Id of the card or context box the user clicked. Takes precedence over the
   * search: a click asks a more specific question than a query does.
   */
  selected?: string | null;
}

export interface FocusedGraph {
  nodes: Node[];
  edges: Edge[];
  /** Ids of the search matches, for Enter-stepping. */
  matches: string[];
}

/** Cards and context boxes outside the focus fade to this. */
const DIM_OPACITY = 0.22;
/** A context box fades less: it also multiplies down whatever sits inside it. */
const DIM_GROUP_OPACITY = 0.5;
const DIM_EDGE_OPACITY = 0.1;
/** Lit edges thicken, so a path reads at a glance. */
const LIT_EDGE_STROKE_WIDTH = 2.5;
/** Put on the clicked card/box; `index.css` draws its ring from it. */
export const FOCUS_ROOT_CLASS = "is-focus-root";

function haystack(node: Node): string {
  const data = node.data as Record<string, unknown>;
  const parts: string[] = [];
  for (const key of ["label", "summary", "httpMethod", "path", "fullName"]) {
    const value = data[key];
    if (typeof value === "string") parts.push(value);
  }
  // Payload fields are searchable too: the search box has always promised
  // "payload fields", and the schema block on the card shows them.
  const payload = data.payload;
  if (payload && typeof payload === "object") {
    for (const [field, type] of Object.entries(payload)) {
      parts.push(field, String(type ?? ""));
    }
  }
  const flows = data.flows;
  if (Array.isArray(flows)) {
    for (const flow of flows) {
      const record = flow as { fromEvent?: string | null; toCommand?: string | null; invariant?: string };
      parts.push(record.fromEvent ?? "", record.toCommand ?? "", record.invariant ?? "");
    }
  }
  return parts.join(" ");
}

const isContextBox = (node: Node): boolean => node.type === "groupNode";

/** A context box focuses itself and every card inside it. */
function coreOf(nodes: Node[], selected: Node): Set<string> {
  const core = new Set<string>([selected.id]);
  if (!isContextBox(selected)) return core;

  // Groups can nest (sub-contexts), so walk until nothing new is contained.
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (node.parentId && core.has(node.parentId) && !core.has(node.id)) {
        core.add(node.id);
        grew = true;
      }
    }
  }
  return core;
}

/** Every context box holding one of `ids`, nested boxes included. */
function contextBoxesAround(nodes: Node[], ids: Set<string>): Set<string> {
  const parentOf = new Map(nodes.map((node) => [node.id, node.parentId]));
  const boxes = new Set<string>();
  for (const id of ids) {
    let parentId = parentOf.get(id);
    while (parentId && !boxes.has(parentId)) {
      boxes.add(parentId);
      parentId = parentOf.get(parentId);
    }
  }
  return boxes;
}

/**
 * The seeds plus everything one edge away, plus the context boxes those cards
 * sit in. A lit box is part of the answer visually: a bright card inside a
 * ghosted frame is hard to read, and the box is what names the context.
 */
function expand(nodes: Node[], edges: Edge[], seeds: Set<string>): Set<string> {
  const lit = new Set(seeds);
  for (const edge of edges) {
    if (seeds.has(edge.source)) lit.add(edge.target);
    if (seeds.has(edge.target)) lit.add(edge.source);
  }
  for (const box of contextBoxesAround(nodes, lit)) lit.add(box);
  return lit;
}

export function focusGraph(
  nodes: Node[],
  edges: Edge[],
  options: FocusOptions,
): FocusedGraph {
  // Spaces in the query mean "anything between these", as in the reference:
  // `Create Folder` lights `CreateFolderCommand`.
  const tokenRegex = buildTokenRegex(options.search);
  const selected = options.selected
    ? nodes.find((node) => node.id === options.selected) ?? null
    : null;

  let matches: string[] = [];
  let lit: Set<string> | null = null;

  if (selected) {
    lit = expand(nodes, edges, coreOf(nodes, selected));
  } else if (tokenRegex) {
    const matched = new Set<string>();
    for (const node of nodes) {
      if (!matchesQuery(haystack(node), tokenRegex)) continue;
      if (isContextBox(node)) {
        // A matching context box lights itself and every card inside it, the
        // same answer clicking its badge gives.
        for (const id of coreOf(nodes, node)) matched.add(id);
      } else {
        matched.add(node.id);
      }
    }
    matches = [...matched];
    lit = expand(nodes, edges, matched);
  }

  if (!lit) return { nodes, edges, matches };
  const focused = lit;
  const rootId = selected?.id ?? null;

  const nextNodes = nodes.map((node) => {
    const next: Node = { ...node };
    if (!focused.has(node.id)) {
      const dim = isContextBox(node) ? DIM_GROUP_OPACITY : DIM_OPACITY;
      next.style = { ...node.style, opacity: dim };
    }
    if (node.id === rootId) {
      next.className = node.className
        ? `${node.className} ${FOCUS_ROOT_CLASS}`
        : FOCUS_ROOT_CLASS;
      // The ring of a clicked card must not be clipped by a neighbour's edge.
      if (!isContextBox(node)) next.zIndex = 6;
    }
    return next;
  });

  const nextEdges = edges.map((edge) => {
    const active = focused.has(edge.source) && focused.has(edge.target);
    const style = {
      ...edge.style,
      opacity: active ? (edge.style?.opacity ?? 1) : DIM_EDGE_OPACITY,
    };
    if (active) style.strokeWidth = LIT_EDGE_STROKE_WIDTH;
    return { ...edge, style };
  });

  return { nodes: nextNodes, edges: nextEdges, matches };
}

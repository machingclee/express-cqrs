import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReactFlowProvider, useReactFlow, type Node } from "@xyflow/react";
import Toolbar from "./components/Toolbar";
import FlowCanvas from "./components/FlowCanvas";
import LoadJsonDialog from "./components/LoadJsonDialog";
import { EndpointError, EndpointLoading } from "./components/EndpointStatus";
import {
  FlowEndpointError,
  flowEndpointPath,
  loadFlowFromFile,
  loadFlowFromUrl,
} from "./flow/load";
import { buildLayout, type LayoutTab } from "./flow/layout";
import { focusGraph } from "./flow/focus";
import type { FlowGraph } from "./flow/types";

const TOKEN_KEY = "backend-event-storming.token";

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const EMPTY_GRAPH: FlowGraph = {
  source: "domain-flow",
  title: "",
  commands: [],
  events: [],
  queries: [],
  policies: [],
  contexts: [],
  dtos: {},
  queryDtos: {},
  externalContexts: [],
};

/** A request to centre one card, minted when a search result is chosen. */
interface FocusRequest {
  id: string;
  nonce: number;
}

function storedToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "flow"
  );
}

/** What the focus hint calls the node: a context box names its context in full. */
function nodeTitle(node: Node): string {
  const data = node.data as { label?: unknown; fullName?: unknown };
  if (node.type === "groupNode") {
    if (typeof data.fullName === "string") return data.fullName;
  }
  if (typeof data.label === "string") return data.label;
  return node.id;
}

function downloadJson(graph: FlowGraph): void {
  const payload = {
    title: graph.title,
    source: graph.source,
    commands: graph.commands,
    events: graph.events,
    policies: graph.policies,
    queries: graph.queries,
    dtos: graph.dtos,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `${slugify(graph.title)}.flow.json`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
}

function EventStormingApp() {
  const { fitView } = useReactFlow();

  const [graph, setGraph] = useState<FlowGraph | null>(null);
  const [sourceLabel, setSourceLabel] = useState(() => flowEndpointPath());
  const [token, setToken] = useState(storedToken);
  const [busy, setBusy] = useState(true);
  const [bootError, setBootError] = useState<Error | null>(null);
  const [tab, setTab] = useState<LayoutTab>(() =>
    new URLSearchParams(window.location.search).get("tab") === "queries" ? "queries" : "commands",
  );
  const [search, setSearch] = useState("");
  /**
   * The card or context box the user clicked. Its neighbours stay bright and
   * the rest fades; this is the graph explorer's "what touches this?" view.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showWildcard, setShowWildcard] = useState(true);
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set());
  /**
   * Bumped when a search result is chosen, so the canvas centres that card even
   * when the same card is chosen twice or the tab had to switch first.
   */
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const focusNonce = useRef(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const toggleSchema = useCallback((nodeIdValue: string) => {
    setExpandedSchemas((previous) => {
      const next = new Set(previous);
      if (next.has(nodeIdValue)) next.delete(nodeIdValue);
      else next.add(nodeIdValue);
      return next;
    });
  }, []);

  const applyGraph = useCallback((next: FlowGraph, label: string) => {
    setGraph(next);
    setSourceLabel(label);
    setBootError(null);
    setError(null);
    setSearch("");
    setSelectedId(null);
    setExpandedSchemas(new Set());
  }, []);

  const loadFromEndpoint = useCallback(
    async (options: { url?: string; token?: string } = {}) => {
      setBusy(true);
      setBootError(null);
      const url = options.url ?? flowEndpointPath();
      try {
        const next = await loadFlowFromUrl(options.url, options.token ?? token);
        applyGraph(next, url);
      } catch (caught) {
        setGraph(null);
        setBootError(caught instanceof Error ? caught : new Error(String(caught)));
      } finally {
        setBusy(false);
      }
    },
    [applyGraph, token],
  );

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    const override = new URLSearchParams(window.location.search).get("url");
    const resolved = override ? new URL(override, document.baseURI).toString() : undefined;
    void loadFromEndpoint({ url: resolved });
  }, [loadFromEndpoint]);

  const useToken = (value: string) => {
    setToken(value);
    try {
      window.localStorage.setItem(TOKEN_KEY, value);
    } catch {
      // Private windows reject storage; the token still works for this session.
    }
    void loadFromEndpoint({ token: value });
  };

  // Geometry only: no search or selection, so neither typing nor clicking ever
  // moves a card the user has dragged.
  const layout = useMemo(
    () =>
      buildLayout(graph ?? EMPTY_GRAPH, {
        tab,
        showWildcard,
        expandedSchemas,
        onToggleSchema: toggleSchema,
      }),
    [graph, tab, showWildcard, expandedSchemas, toggleSchema],
  );

  // An id that no longer exists (a tab switch, a reload) simply stops focusing.
  const selectedNode = useMemo(
    () =>
      selectedId ? layout.nodes.find((node) => node.id === selectedId) ?? null : null,
    [layout, selectedId],
  );

  const focused = useMemo(
    () =>
      focusGraph(layout.nodes, layout.edges, {
        search,
        selected: selectedNode?.id ?? null,
      }),
    [layout, search, selectedNode],
  );

  /**
   * A click toggles its own focus, so a second click on the same card brings the
   * whole drawing back. Search and click focus are separate questions, so the
   * click clears the query rather than leaving a badge that no longer describes
   * what is lit.
   */
  const activateNode = useCallback((node: Node) => {
    setSelectedId((previous) => (previous === node.id ? null : node.id));
    setSearch("");
  }, []);

  const clearFocus = useCallback(() => setSelectedId(null), []);

  /** Typing takes over from a click: matches light up, a click's focus goes. */
  const changeSearch = useCallback((value: string) => {
    setSearch(value);
    setSelectedId(null);
  }, []);

  /**
   * A search result: open the tab its card lives on, focus it, and ask the
   * canvas to centre it. The query goes away so the focus hint describes what
   * is on screen.
   */
  const navigateToNode = useCallback((targetId: string, targetTab: LayoutTab) => {
    setTab(targetTab);
    setSearch("");
    setSelectedId(targetId);
    focusNonce.current += 1;
    setFocusRequest({ id: targetId, nonce: focusNonce.current });
  }, []);

  // A tab switch draws a different set of cards; drop an id that no longer
  // exists rather than dimming the whole drawing for a card that is gone. An id
  // chosen from the search is set together with its tab, so it survives here.
  useEffect(() => {
    if (selectedId && !layout.nodes.some((node) => node.id === selectedId)) {
      setSelectedId(null);
    }
  }, [layout, selectedId]);

  // Escape returns the whole drawing, like clicking the background.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const dropFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      applyGraph(await loadFlowFromFile(file), file.name);
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`flow-app${dragging ? " is-dragging" : ""}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void dropFile(event.dataTransfer.files?.[0]);
      }}
    >
      {graph ? (
        <>
          <FlowCanvas
            nodes={focused.nodes}
            edges={focused.edges}
            contentWidth={layout.width}
            fitKey={`${sourceLabel}|${tab}|${graph.title}`}
            layoutKey={`${sourceLabel}|${tab}|${showWildcard}|${graph.title}|${[...expandedSchemas].sort().join(",")}`}
            focusRequest={focusRequest}
            onNodeActivate={activateNode}
            onClearFocus={clearFocus}
          />
        </>
      ) : bootError ? (
        <EndpointError
          error={bootError}
          endpoint={flowEndpointPath()}
          busy={busy}
          needsToken={
            bootError instanceof FlowEndpointError &&
            (bootError.status === 401 || bootError.status === 403)
          }
          onRetry={() => void loadFromEndpoint()}
          onUseToken={useToken}
          onOpenLoad={() => setDialogOpen(true)}
        />
      ) : (
        <EndpointLoading endpoint={flowEndpointPath()} />
      )}

      <Toolbar
        graph={graph}
        loading={busy}
        stats={layout.stats}
        endpoint={flowEndpointPath()}
        tab={tab}
        onTabChange={setTab}
        search={search}
        onSearchChange={changeSearch}
        onNavigate={navigateToNode}
        showWildcard={showWildcard}
        onToggleWildcard={() => setShowWildcard((value) => !value)}
        onFitAll={() => fitView({ padding: 0.15, duration: 400 })}
        onOpenLoad={() => setDialogOpen(true)}
        onReload={() => void loadFromEndpoint()}
        onExport={() => graph && downloadJson(graph)}
        sourceLabel={sourceLabel}
      />

      {/* Says what is lit and how to undo it: without a hint the faded rest of
          the drawing looks like a fault rather than a selection. */}
      {selectedNode && (
        <div className="flow-focus-hint" role="status">
          <span className="flow-focus-dot" aria-hidden />
          <span>
            Focus: <strong>{nodeTitle(selectedNode)}</strong>
            <em>
              {selectedNode.type === "groupNode"
                ? " · this context and what it reaches"
                : " · this card and its neighbours"}
            </em>
          </span>
          <button type="button" onClick={clearFocus} title="Clear focus (Esc)">
            ✕
          </button>
        </div>
      )}

      {error && (
        <div className="flow-alert" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} title="Dismiss">
            ✕
          </button>
        </div>
      )}

      <LoadJsonDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        onLoaded={applyGraph}
        token={token}
      />

      {dragging && <div className="drop-hint">Drop the flow JSON to draw it</div>}
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <EventStormingApp />
    </ReactFlowProvider>
  );
}

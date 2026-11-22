import { useEffect } from "react";
import {
  Handle,
  Position,
  useNodeId,
  useUpdateNodeInternals,
  type NodeProps,
  type Node,
} from "@xyflow/react";
import { POLICY_NODE_WIDTH } from "../../flow/theme";
import type { PolicyNodeData } from "../../flow/layout";
import { policyHandles } from "../../flow/policy";

/**
 * The policy card of `echarge-event-storming-component`, read-only: the policy
 * name across the top, an "Invariants" heading, then one numbered block per
 * business rule with the event → command routing it justifies.
 *
 * Every block carries its own target/source handles (`t-0` / `s-0`, …) as in the
 * reference, so the layout can point an event at the block that names it and the
 * arrows spread over the card's height instead of converging on one point. The
 * centre handles are the fallback for edges no block names (wildcard
 * subscriptions) and stay invisible.
 *
 * Colours come from the CSS variables the reference sets in `index.css`
 * (`--policy-bg`, `--policy-border`), so the card matches its stylesheet rather
 * than carrying hard-coded purples.
 */
export default function PolicyNode({ data }: NodeProps<Node<PolicyNodeData>>) {
  const nodeId = useNodeId();
  const updateNodeInternals = useUpdateNodeInternals();

  // The card's height follows its rule list, and a reload can add or drop rules.
  // React Flow caches handle bounds per node, so tell it to measure again once
  // the new rows are in the DOM; without this the edges keep the old heights.
  useEffect(() => {
    if (nodeId) updateNodeInternals(nodeId);
  }, [nodeId, data.flows, updateNodeInternals]);

  return (
    <div
      style={{
        background: "var(--policy-bg)",
        border: "2px solid var(--policy-border)",
        borderRadius: "8px",
        padding: "10px 14px",
        color: "#fff",
        width: POLICY_NODE_WIDTH,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          letterSpacing: "0.05em",
          opacity: 0.9,
          fontSize: 30,
          marginBottom: "8px",
          paddingBottom: "6px",
          borderBottom: "1px solid rgba(255,255,255,0.45)",
          wordBreak: "break-word",
          textAlign: "center",
          transition: "color 0.4s ease",
          color: data.copied ? "#4ade80" : "inherit",
          fontWeight: data.copied ? 600 : "inherit",
        }}
      >
        <span>{data.copied ? "✓ Copied" : data.label}</span>
      </div>

      <div
        style={{
          display: "flex",
          justifyContent: "center",
          fontSize: "24px",
          letterSpacing: "0.05em",
          opacity: 0.85,
          marginBottom: "6px",
        }}
      >
        Invariants
      </div>

      {/*
        Fallback anchors for edges no rule names (a wildcard subscription is to
        every event, not to one rule). They sit at the middle of the rule list
        rather than of the card, so on a card with a single rule they coincide
        with that rule's own handle instead of floating up in the heading. The
        offsets put them on the card's border, level with the row handles.
      */}
      <div style={{ position: "relative" }}>
        <Handle
          type="target"
          position={Position.Left}
          id={policyHandles.targetCentre}
          style={{ left: -14, opacity: 0 }}
        />
        <Handle
          type="source"
          position={Position.Right}
          id={policyHandles.sourceCentre}
          style={{ right: -10, opacity: 0 }}
        />

        <ul style={{ margin: 0, paddingLeft: "16px", listStyleType: "none" }}>
          {data.flows.map((flow, index) => (
            <li
              key={index}
              style={{
                position: "relative",
                marginBottom: "10px",
                borderRadius: "6px",
                padding: "8px 10px",
              }}
            >
              {/* `left: -30` clears the card's padding plus the list indent, so the
                  dot sits on the card's border, as it does in the reference. */}
              <Handle
                type="target"
                position={Position.Left}
                id={policyHandles.target(index)}
                style={{ left: -30 }}
              />
              <Handle
                type="source"
                position={Position.Right}
                id={policyHandles.source(index)}
                style={{ right: -10 }}
              />

              <div
                style={{ fontSize: "20px", lineHeight: 1.2, marginBottom: "4px" }}
                className="markdown-invariant"
              >
                <div style={{ display: "flex" }}>
                  <div
                    style={{
                      marginRight: "8px",
                      opacity: 0.6,
                      fontSize: "18px",
                      fontStyle: "italic",
                    }}
                  >
                    <div
                      style={{
                        background: "rgba(255,255,255,0.2)",
                        borderRadius: "4px",
                        padding: "4px 6px",
                      }}
                    >
                      {String(index + 1).padStart(2, "0")}.
                    </div>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ marginBottom: 10 }}>
                      {flow.invariant || (
                        <span style={{ fontStyle: "italic", opacity: 0.6 }}>No rule text</span>
                      )}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      {flow.fromEvent ? (
                        <span
                          style={{
                            display: "inline-block",
                            background: "rgba(249,115,22,0.85)",
                            border: "1px solid rgba(255,255,255,0.4)",
                            borderRadius: "4px",
                            padding: "1px 7px",
                            fontSize: "16px",
                            letterSpacing: "0.02em",
                          }}
                        >
                          {flow.fromEvent}
                        </span>
                      ) : (
                        <span
                          style={{
                            display: "inline-block",
                            background: "rgba(0,0,0,0.25)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "4px",
                            padding: "1px 7px",
                            fontSize: "14px",
                            fontStyle: "italic",
                            opacity: 0.7,
                          }}
                        >
                          No Event
                        </span>
                      )}
                      <span style={{ fontSize: "11px", opacity: 0.7 }}>→</span>
                      {flow.toCommand ? (
                        <span
                          style={{
                            display: "inline-block",
                            background: "rgba(37,99,235,0.85)",
                            border: "1px solid rgba(255,255,255,0.4)",
                            borderRadius: "4px",
                            padding: "1px 7px",
                            fontSize: "16px",
                            letterSpacing: "0.02em",
                          }}
                        >
                          {flow.toCommand}
                        </span>
                      ) : (
                        <span
                          style={{
                            display: "inline-block",
                            background: "rgba(0,0,0,0.25)",
                            border: "1px solid rgba(255,255,255,0.2)",
                            borderRadius: "4px",
                            padding: "1px 7px",
                            fontSize: "14px",
                            fontStyle: "italic",
                            opacity: 0.7,
                          }}
                        >
                          No Command
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

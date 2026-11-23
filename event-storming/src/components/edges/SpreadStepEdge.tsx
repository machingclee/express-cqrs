import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  type EdgeProps,
} from "@xyflow/react";
import { AfterCommitIcon } from "../icons";

/**
 * A smooth-step edge whose vertical segment can be horizontally offset
 * via `data.spread` (in pixels).
 *
 * Forward edges (source left of target, e.g. Event→Policy):
 *   vertical segment sits between the two nodes, spread by `data.spread`.
 *
 * Backward edges (source right of target, e.g. Policy→Command):
 *   vertical segment is anchored to the RIGHT of the source node so it
 *   stays on the far side of the policy column, away from incoming edges.
 *   `data.spread` fans multiple outgoing edges apart.
 *
 * A command → event edge whose `data.postCommit` is set also carries a clock
 * badge at its bend: that emission leaves after the transaction commits, so the
 * marker belongs to the edge rather than to the event card (the same event can
 * be dispatched immediately elsewhere).
 */

const BORDER_RADIUS = 8;

/** Distance from the source handle that the vertical segment is placed
 *  for backward (right-to-left) edges. */
/** Fixed distance to the right of the source handle where the vertical
 *  segment sits for backward edges.  Mirrors the ~300 px gap that
 *  forward edges naturally get from the column midpoint. */
const BACKWARD_BASE_OFFSET = 250;

/** Vertical offset for the final approach to the target node.
 *  The edge enters the target from slightly above (or below, if
 *  target is above source) so the line does not appear to punch
 *  straight through the node. */
const TARGET_APPROACH_OFFSET = 40;

/** Build an SVG path for a backward edge whose vertical segment sits
 *  to the RIGHT of the source (centerX >= sourceX). */
function backwardStepPathRight(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  centerX: number,
): string {
  const r = Math.min(
    BORDER_RADIUS,
    Math.abs(centerX - sourceX) / 2,
    Math.abs(centerX - targetX) / 2,
    Math.abs(targetY - sourceY) / 2,
  );

  // Approach the target from slightly above/below so the final
  // segment enters at a shallow angle instead of horizontally.
  const ySign = targetY >= sourceY ? 1 : -1;
  const approachY = targetY - TARGET_APPROACH_OFFSET * ySign;

  if (r <= 1) {
    return [
      `M ${sourceX},${sourceY}`,
      `L ${centerX},${sourceY}`,
      `L ${centerX},${approachY}`,
      `L ${targetX},${targetY}`,
    ].join(" ");
  }

  // Path: source → right to near centerX → curve → vertical →
  //       curve → left to past the target → curve right+down
  //       into target (arrow points RIGHT, entering the node)
  // prettier-ignore
  return [
    `M ${sourceX},${sourceY}`,
    `L ${centerX - r},${sourceY}`,
    `Q ${centerX},${sourceY} ${centerX},${sourceY + ySign * r}`,
    `L ${centerX},${approachY - ySign * r}`,
    `Q ${centerX},${approachY} ${centerX - r},${approachY}`,
    `L ${targetX - 3 * r},${approachY}`,
    `L ${targetX - 3 * r},${targetY}`,
    `L ${targetX},${targetY}`,
  ].join(" ");
}

const SpreadStepEdge = ({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition = Position.Right,
  targetPosition = Position.Left,
  data,
  style,
  markerEnd,
}: EdgeProps) => {
  // Guard against NaN / Infinity from unmeasured nodes.
  if (!isFinite(sourceX) || !isFinite(sourceY) || !isFinite(targetX) || !isFinite(targetY)) {
    return null;
  }
  const { spread = 0, postCommit = false } = (data ?? {}) as {
    spread?: number;
    postCommit?: boolean;
  };

  let edgePath: string;
  let labelX = (sourceX + targetX) / 2;
  let labelY = (sourceY + targetY) / 2;
  if (sourceX <= targetX) {
    // Forward — vertical segment centred between nodes
    const centerX = (sourceX + targetX) / 2 + spread;
    [edgePath, labelX, labelY] = getSmoothStepPath({
      sourceX,
      sourceY,
      targetX,
      targetY,
      sourcePosition,
      targetPosition,
      centerX,
      borderRadius: BORDER_RADIUS,
    });
  } else {
    // Backward — vertical segment on the RIGHT of the source
    const centerX = sourceX + BACKWARD_BASE_OFFSET + spread;
    edgePath = backwardStepPathRight(sourceX, sourceY, targetX, targetY, centerX);
    labelX = centerX;
    labelY = (sourceY + targetY) / 2;
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} markerEnd={markerEnd} />
      {postCommit && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan nowheel"
            title="Transactional: this emission is dispatched after the command commits"
            aria-label="transactional, dispatched after the commit"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 22,
              height: 22,
              borderRadius: "50%",
              background: "#1e293b",
              border: "1.5px solid rgba(255,255,255,0.9)",
              color: "#fff",
              boxShadow: "0 1px 4px rgba(15, 23, 42, 0.45)",
              pointerEvents: "all",
              cursor: "help",
            }}
          >
            <AfterCommitIcon size={13} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
};

export default SpreadStepEdge;

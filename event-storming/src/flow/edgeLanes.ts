/**
 * The horizontal offset of a `spreadStep` edge's vertical run.
 *
 * Each edge leaves its source handle, runs right (or left), turns vertical for a
 * stretch between the columns, and enters the target. That vertical run is what
 * `data.spread` slides sideways. The offset used to be computed from the local
 * fan only — "the third of this command's four events" — so a command emitting a
 * single event always got offset 0. Ten commands emitting the same event (the
 * undo/redo shape: every original command has an opposite twin that announces
 * the same happened-event) therefore drew ten edges on exactly the same trunk,
 * and the bundle read as one line.
 *
 * The offset has to be assigned over the edges that actually compete for the
 * same strip of canvas: edges whose vertical runs overlap must not share a
 * trunk. That is interval-graph colouring, and it is exact with the greedy below
 * — sort by the top of the run, take the first lane that has already ended — so
 * a bundle of N mutually overlapping edges gets exactly N lanes, while edges far
 * apart vertically may reuse one. Sharing a trunk is then a property of geometry
 * (the runs never meet) rather than an accident of loop counters.
 *
 * Two further details keep it readable:
 *
 *   - runs are coloured per overlap-connected component, and each component is
 *     centred in the gap on its own. A dense fan is centred where it belongs
 *     without dragging unrelated single edges away from the middle.
 *   - the step shrinks when the gap cannot hold the preferred spacing, so the
 *     outermost lane never reaches a card face.
 */

export interface EdgeSpan {
  /** Edge id, so the caller can put the offset back on that edge. */
  id: string;
  /** Top and bottom of the vertical run: the two handle y positions. */
  top: number;
  bottom: number;
}

export interface LaneOptions {
  /** Width the vertical runs may occupy, handle to handle, less any padding. */
  room: number;
  /** Preferred distance between two neighbouring runs. */
  preferredStep: number;
}

/**
 * One offset per edge id, relative to the midpoint between the two columns.
 * Edges of a lone component get 0, i.e. the middle of the gap.
 */
export function laneOffsets(
  spans: EdgeSpan[],
  options: LaneOptions,
): Map<string, number> {
  const offsets = new Map<string, number>();
  if (spans.length === 0) return offsets;

  const ordered = [...spans].sort(
    (a, b) => a.top - b.top || a.bottom - b.bottom || a.id.localeCompare(b.id),
  );

  // Overlap-connected components: a run belongs to the current bundle while it
  // starts before everything already in it has ended.
  let component: EdgeSpan[] = [];
  let componentBottom = Number.NEGATIVE_INFINITY;

  const flush = () => {
    if (component.length === 0) return;
    const lanes = colour(component);
    const laneCount = Math.max(...lanes) + 1;
    const step =
      laneCount <= 1
        ? 0
        : Math.min(options.preferredStep, options.room / (laneCount - 1));
    component.forEach((span, index) => {
      offsets.set(span.id, (lanes[index] - (laneCount - 1) / 2) * step);
    });
    component = [];
    componentBottom = Number.NEGATIVE_INFINITY;
  };

  for (const span of ordered) {
    if (component.length > 0 && span.top >= componentBottom) flush();
    component.push(span);
    componentBottom = Math.max(componentBottom, span.bottom);
  }
  flush();

  return offsets;
}

/**
 * Greedy interval colouring of one bundle: the first lane whose last run ended
 * at or above this run's top can be reused. Lanes are numbered in allocation
 * order, so their order follows the runs down the canvas.
 */
function colour(spans: EdgeSpan[]): number[] {
  const laneEnds: number[] = [];
  const lanes: number[] = [];
  for (const span of spans) {
    let lane = laneEnds.findIndex((end) => end <= span.top);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(span.bottom);
    } else {
      laneEnds[lane] = span.bottom;
    }
    lanes.push(lane);
  }
  return lanes;
}

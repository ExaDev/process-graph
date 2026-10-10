import type { Direction } from "./engine.ts";

/**
 * The unit every dimension below is a multiple of, so nodes of different shapes and lanes align on one grid and a renderer that snaps to a grid snaps to the same points.
 */
const GRID = 8;

/** The room a node of each kind of shape takes, in the coordinate space of the layout. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A process step or state: wide enough for a short label on one line. */
const PROCESS_UNITS = { width: 20, height: 8 };

/** A start or end terminator: a rounded box smaller than a step, so it reads as a boundary. */
const TERMINATOR_UNITS = { width: 12, height: 6 };

/** A decision diamond: taller than a step, because a diamond has less usable width than the box that encloses it. */
const DECISION_UNITS = { width: 16, height: 12 };

/** The initial and final pseudo-states of a state machine: a dot, as in the notation. */
const PSEUDO_STATE_UNITS = { width: 4, height: 4 };

/** The thin side of a fork or join bar, and its length. */
const BAR_THICKNESS_UNITS = 1;
const BAR_LENGTH_UNITS = 12;

/** The default gap between two nodes in the same layer: half a step's height, which keeps parallel edges distinguishable. */
const NODE_GAP_UNITS = 4;

/** The default gap between layers: wider than the node gap so an edge has room for a label and an arrowhead. */
const LAYER_GAP_UNITS = 8;

/** The space between a lane's border and the nodes inside it: enough for the lane's own header and for a node not to touch the border. */
const LANE_PADDING_UNITS = 4;

/** The least a lane may measure, so a lane with no nodes is still visible. */
const LANE_MINIMUM_UNITS = { width: 24, height: 12 };

const sized = (units: {
  readonly width: number;
  readonly height: number;
}): Size => ({
  width: units.width * GRID,
  height: units.height * GRID,
});

export const PROCESS_SIZE: Size = sized(PROCESS_UNITS);
export const TERMINATOR_SIZE: Size = sized(TERMINATOR_UNITS);
export const DECISION_SIZE: Size = sized(DECISION_UNITS);
export const PSEUDO_STATE_SIZE: Size = sized(PSEUDO_STATE_UNITS);
export const DEFAULT_NODE_GAP = NODE_GAP_UNITS * GRID;
export const DEFAULT_LAYER_GAP = LAYER_GAP_UNITS * GRID;
export const LANE_PADDING = LANE_PADDING_UNITS * GRID;
export const LANE_MINIMUM_SIZE: Size = sized(LANE_MINIMUM_UNITS);

/**
 * The bar across the flow: a fork or join is drawn perpendicular to the edges it gathers or splits, so it is tall when edges run sideways and wide when they run vertically.
 */
export const barSize = (direction: Direction): Size => {
  const thickness = BAR_THICKNESS_UNITS * GRID;
  const length = BAR_LENGTH_UNITS * GRID;

  return direction === "right" || direction === "left"
    ? { width: thickness, height: length }
    : { width: length, height: thickness };
};

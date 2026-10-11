import { vars } from "@exadev/process-graph-ui";
import { globalStyle, style } from "@vanilla-extract/css";

/** An element node: its card fills the box the layout gave it. */
export const elementNode = style({ display: "flex" });

globalStyle(`${elementNode} > [data-element-id]`, {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
});

/** A lane node: the lane fills the box the layout gave it, behind the elements it holds. */
export const laneNode = style({ display: "flex" });

globalStyle(`${laneNode} > [data-lane]`, {
  flex: 1,
  backgroundColor: vars.colour.background,
});

/** A connection handle: present for React Flow's routing, not drawn. */
export const handle = style({ opacity: 0 });

/** A transition's line, and its label in muted text. */
export const transitionEdge = style({});

globalStyle(`${transitionEdge} .react-flow__edge-path`, {
  stroke: vars.colour.muted,
  strokeWidth: vars.stroke.thin,
});

globalStyle(`${transitionEdge} .react-flow__edge-text`, {
  fill: vars.colour.muted,
  fontSize: vars.font.sizeSmall,
});

/** A hand-off between actors, in the hand-off colour. */
export const handoffEdge = style({});

globalStyle(`${handoffEdge} .react-flow__edge-path`, {
  stroke: vars.colour.handoff,
});

/** A step of the critical path: drawn thicker, in the critical colour. */
export const criticalEdge = style({});

globalStyle(`${criticalEdge} .react-flow__edge-path`, {
  stroke: vars.colour.critical,
  strokeWidth: vars.stroke.thick,
});

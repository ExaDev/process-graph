import { style } from "@vanilla-extract/css";
import { vars } from "./theme.css.ts";

/** The dash of a lifeline, a reply and an operand divider: dash and gap of equal length, half a grid unit each. */
const dashed = "4 4";

export const sequenceFigure = style({ margin: 0 });

export const sequenceCaption = style({
  marginBottom: vars.space.medium,
  fontWeight: vars.font.weightStrong,
});

export const sequenceSvg = style({ display: "block", maxWidth: "100%" });

export const lifelineHead = style({
  fill: vars.colour.surface,
  stroke: vars.colour.border,
  strokeWidth: vars.stroke.thin,
});

export const lifelineLine = style({
  stroke: vars.colour.muted,
  strokeWidth: vars.stroke.thin,
  strokeDasharray: dashed,
});

export const diagramText = style({
  fill: vars.colour.text,
  fontFamily: vars.font.body,
  fontSize: vars.font.sizeBody,
});

export const messageLabel = style({
  fill: vars.colour.muted,
  fontFamily: vars.font.body,
  fontSize: vars.font.sizeSmall,
});

/** A message line; a reply is dashed, as the notation draws it. */
export const messageLine = style({
  fill: "none",
  stroke: vars.colour.text,
  strokeWidth: vars.stroke.thin,
  selectors: {
    '&[data-mode="reply"]': { strokeDasharray: dashed },
  },
});

export const arrowFilled = style({ fill: vars.colour.text });

export const arrowOpen = style({
  fill: "none",
  stroke: vars.colour.text,
  strokeWidth: vars.stroke.thin,
});

export const fragmentFrame = style({
  fill: "none",
  stroke: vars.colour.border,
  strokeWidth: vars.stroke.thin,
});

export const fragmentDivider = style({
  stroke: vars.colour.border,
  strokeWidth: vars.stroke.thin,
  strokeDasharray: dashed,
});

export const fragmentTag = style({
  fill: vars.colour.surface,
  stroke: vars.colour.border,
  strokeWidth: vars.stroke.thin,
});

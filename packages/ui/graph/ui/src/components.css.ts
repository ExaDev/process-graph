import { style } from "@vanilla-extract/css";
import { recipe } from "@vanilla-extract/recipes";
import { focusRing } from "./base.css.ts";
import { byStatus, byStatusAttribute } from "./status.css.ts";
import { vars } from "./theme.css.ts";

/** A status badge: the status's name in its colour, outlined in the same colour, so it reads by text and by colour. */
export const badge = recipe({
  base: {
    display: "inline-flex",
    alignItems: "center",
    padding: `0 ${vars.space.small}`,
    border: `${vars.stroke.thin} solid currentColor`,
    borderRadius: vars.radius.small,
    fontSize: vars.font.sizeSmall,
    fontWeight: vars.font.weightStrong,
    whiteSpace: "nowrap",
  },
  variants: {
    status: byStatus((colour) => ({ color: colour })),
  },
});

/** An element card: a bordered surface whose leading edge carries the status colour, shaped by the element's kind. */
export const card = recipe({
  base: [
    focusRing,
    {
      display: "flex",
      flexWrap: "wrap",
      alignItems: "center",
      gap: vars.space.small,
      padding: vars.space.medium,
      backgroundColor: vars.colour.surface,
      border: `${vars.stroke.thin} solid ${vars.colour.border}`,
      borderLeftWidth: vars.stroke.thick,
      borderRadius: vars.radius.medium,
      cursor: "default",
      selectors: {
        '&[aria-selected="true"]': {
          outline: `${vars.stroke.thick} solid ${vars.colour.accent}`,
        },
      },
    },
  ],
  variants: {
    status: byStatus((colour) => ({ borderLeftColor: colour })),
    kind: {
      activity: {},
      state: {},
      decision: { borderStyle: "dashed" },
      pseudo: { borderRadius: vars.space.large },
      message: { fontStyle: "italic" },
    },
    critical: {
      true: { boxShadow: `0 0 0 ${vars.stroke.thick} ${vars.colour.critical}` },
      false: {},
    },
  },
});

export const cardLabel = style({ fontWeight: vars.font.weightStrong });

export const criticalMarker = style({
  color: vars.colour.critical,
  fontSize: vars.font.sizeSmall,
  fontWeight: vars.font.weightStrong,
});

export const blockersNote = style({
  flexBasis: "100%",
  color: vars.colour.muted,
  fontSize: vars.font.sizeSmall,
});

/** A transition: muted text, in the hand-off colour when it passes work between actors and the critical colour on the critical path. */
export const transition = style({
  color: vars.colour.muted,
  selectors: {
    "&[data-handoff]": { color: vars.colour.handoff },
    "&[data-critical]": {
      color: vars.colour.critical,
      fontWeight: vars.font.weightStrong,
    },
  },
});

export const transitionEnd = style({ color: vars.colour.text });

export const lane = style({
  border: `${vars.stroke.thin} solid ${vars.colour.border}`,
  borderRadius: vars.radius.medium,
  padding: vars.space.medium,
});

export const laneHeading = style({
  margin: `0 0 ${vars.space.medium}`,
  color: vars.colour.muted,
  fontSize: vars.font.sizeSmall,
  textTransform: "uppercase",
});

export const laneBody = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.medium,
});

export const legend = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.large,
  margin: 0,
  padding: 0,
  listStyle: "none",
  fontSize: vars.font.sizeSmall,
});

export const legendItem = style({
  display: "inline-flex",
  alignItems: "center",
  gap: vars.space.small,
});

/** A legend swatch, coloured by its own `data-status`, or as the critical path for `data-critical`. */
export const swatch = style({
  display: "inline-block",
  width: vars.font.sizeSmall,
  height: vars.font.sizeSmall,
  borderRadius: vars.radius.small,
  selectors: {
    ...byStatusAttribute((colour) => ({ backgroundColor: colour })),
    "&[data-critical]": { backgroundColor: vars.colour.critical },
  },
});

export const filterPanel = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "flex-start",
  gap: vars.space.large,
});

export const filterGroup = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.medium,
  margin: 0,
  border: `${vars.stroke.thin} solid ${vars.colour.border}`,
  borderRadius: vars.radius.medium,
  padding: vars.space.medium,
});

export const filterLegend = style({
  padding: `0 ${vars.space.small}`,
  color: vars.colour.muted,
  fontSize: vars.font.sizeSmall,
});

export const filterOption = style({
  display: "inline-flex",
  alignItems: "center",
  gap: vars.space.small,
});

export const checkbox = style([focusRing, { accentColor: vars.colour.accent }]);

export const button = style([
  focusRing,
  {
    padding: `${vars.space.small} ${vars.space.medium}`,
    color: vars.colour.accent,
    backgroundColor: "transparent",
    border: `${vars.stroke.thin} solid ${vars.colour.border}`,
    borderRadius: vars.radius.small,
    font: "inherit",
    cursor: "pointer",
  },
]);

export const detailPanel = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: vars.space.medium,
  padding: vars.space.large,
  backgroundColor: vars.colour.surface,
  border: `${vars.stroke.thin} solid ${vars.colour.border}`,
  borderRadius: vars.radius.medium,
});

export const detailHeading = style({
  margin: 0,
  fontSize: vars.font.sizeHeading,
});

export const detailReason = style({ margin: 0 });

export const detailSectionHeading = style({
  margin: 0,
  color: vars.colour.muted,
  fontSize: vars.font.sizeSmall,
});

export const detailList = style({
  margin: `${vars.space.small} 0 0`,
  paddingLeft: vars.space.large,
});

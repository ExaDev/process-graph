import { vars } from "@exadev/process-graph-ui";
import { globalStyle, style, styleVariants } from "@vanilla-extract/css";

// Every value comes from graph-ui's theme contract, so a theme assigned to the contract restyles the app shell with the views inside it.

globalStyle("html, body, #root", {
  margin: 0,
  height: "100%",
});

/** The whole app: the theme's surface, a header, any notices, then the work. */
export const shell = style({
  display: "flex",
  flexDirection: "column",
  minHeight: "100%",
  boxSizing: "border-box",
});

export const header = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.medium,
  padding: `${vars.space.medium} ${vars.space.large}`,
  borderBottom: `${vars.stroke.thin} solid ${vars.colour.border}`,
});

export const title = style({
  margin: 0,
  marginRight: "auto",
  fontSize: vars.font.sizeHeading,
  fontWeight: vars.font.weightStrong,
});

export const skipLink = style({
  position: "absolute",
  left: vars.space.medium,
  top: "-100%",
  selectors: {
    "&:focus": { top: vars.space.medium },
  },
});

export const main = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.large,
  padding: vars.space.large,
  flex: 1,
  minHeight: 0,
});

/** A notice across the page: offline, an update, a failure. */
const noticeBase = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.medium,
  margin: 0,
  padding: `${vars.space.medium} ${vars.space.large}`,
  borderBottom: `${vars.stroke.thin} solid ${vars.colour.border}`,
  background: vars.colour.surface,
});

export const notice = styleVariants({
  info: [
    noticeBase,
    { borderLeft: `${vars.stroke.thick} solid ${vars.colour.accent}` },
  ],
  warning: [
    noticeBase,
    { borderLeft: `${vars.stroke.thick} solid ${vars.colour.critical}` },
  ],
  error: [
    noticeBase,
    {
      borderLeft: `${vars.stroke.thick} solid ${vars.colour.status.blocked}`,
    },
  ],
});

export const section = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.medium,
  padding: vars.space.large,
  border: `${vars.stroke.thin} solid ${vars.colour.border}`,
  borderRadius: vars.radius.medium,
  background: vars.colour.surface,
});

export const sectionHeading = style({
  margin: 0,
  fontSize: vars.font.sizeHeading,
  fontWeight: vars.font.weightStrong,
});

export const muted = style({
  color: vars.colour.muted,
  margin: 0,
});

export const row = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: vars.space.medium,
});

export const button = style({
  font: "inherit",
  color: vars.colour.text,
  background: vars.colour.background,
  border: `${vars.stroke.thin} solid ${vars.colour.border}`,
  borderRadius: vars.radius.small,
  padding: `${vars.space.small} ${vars.space.medium}`,
  cursor: "pointer",
  selectors: {
    "&:disabled": { color: vars.colour.muted, cursor: "not-allowed" },
    "&:focus-visible": {
      outline: `${vars.stroke.thick} solid ${vars.colour.focus}`,
      outlineOffset: vars.stroke.thin,
    },
  },
});

export const primaryButton = style([
  button,
  {
    color: vars.colour.background,
    background: vars.colour.accent,
    borderColor: vars.colour.accent,
  },
]);

export const input = style({
  font: "inherit",
  color: vars.colour.text,
  background: vars.colour.background,
  border: `${vars.stroke.thin} solid ${vars.colour.border}`,
  borderRadius: vars.radius.small,
  padding: `${vars.space.small} ${vars.space.medium}`,
  minWidth: 0,
  selectors: {
    "&:focus-visible": {
      outline: `${vars.stroke.thick} solid ${vars.colour.focus}`,
      outlineOffset: vars.stroke.thin,
    },
  },
});

export const field = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.small,
});

export const list = style({
  margin: 0,
  paddingLeft: vars.space.large,
});

export const chip = style({
  display: "inline-flex",
  alignItems: "center",
  gap: vars.space.small,
  padding: `${vars.space.small} ${vars.space.medium}`,
  border: `${vars.stroke.thin} solid ${vars.colour.border}`,
  borderRadius: vars.radius.medium,
  fontFamily: vars.font.mono,
  fontSize: vars.font.sizeSmall,
});

/** The work: the view beside the lists and details, stacked on a narrow screen. */
export const workspace = style({
  display: "grid",
  gap: vars.space.large,
  gridTemplateColumns: "minmax(0, 1fr)",
  "@media": {
    "(min-width: 64rem)": {
      gridTemplateColumns: "minmax(0, 3fr) minmax(18rem, 1fr)",
    },
  },
});

export const sidebar = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.large,
  minWidth: 0,
});

/** React Flow fills its container, so the canvas needs a height of its own. */
export const canvas = style({
  height: "70vh",
  minHeight: "24rem",
  border: `${vars.stroke.thin} solid ${vars.colour.border}`,
  borderRadius: vars.radius.medium,
  overflow: "auto",
});

export const tabList = style({
  display: "flex",
  flexWrap: "wrap",
  gap: vars.space.small,
  borderBottom: `${vars.stroke.thin} solid ${vars.colour.border}`,
});

export const tab = style([
  button,
  {
    border: "none",
    borderBottom: `${vars.stroke.thick} solid transparent`,
    borderRadius: 0,
    background: "transparent",
    selectors: {
      '&[aria-selected="true"]': {
        borderBottomColor: vars.colour.accent,
        fontWeight: vars.font.weightStrong,
      },
    },
  },
]);

export const option = style({
  padding: `${vars.space.small} ${vars.space.medium}`,
  borderRadius: vars.radius.small,
  cursor: "pointer",
  selectors: {
    '&[aria-selected="true"]': {
      outline: `${vars.stroke.thick} solid ${vars.colour.accent}`,
    },
    "&:focus-visible": {
      outline: `${vars.stroke.thick} solid ${vars.colour.focus}`,
    },
  },
});

export const listbox = style({
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.small,
});

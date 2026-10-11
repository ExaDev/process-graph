import { globalStyle, style } from "@vanilla-extract/css";
import { vars } from "./theme.css.ts";

/** The element a theme class goes on: the page colours and type every component inherits. */
export const surfaceRoot = style({
  backgroundColor: vars.colour.background,
  color: vars.colour.text,
  fontFamily: vars.font.body,
  fontSize: vars.font.sizeBody,
});

/** Present to assistive technology, absent from the page: the text alternative of a drawing. */
export const visuallyHidden = style({
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
});

/** The focus ring every focusable part shows when focused from the keyboard. */
export const focusRing = style({
  selectors: {
    "&:focus-visible": {
      outline: `${vars.stroke.thick} solid ${vars.colour.focus}`,
      outlineOffset: vars.stroke.thin,
    },
  },
});

globalStyle(
  `${surfaceRoot} *, ${surfaceRoot} *::before, ${surfaceRoot} *::after`,
  {
    boxSizing: "border-box",
  },
);

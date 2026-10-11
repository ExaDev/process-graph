import type { Status } from "@exadev/process-graph-domain";

/**
 * The shape of every theme: each leaf is a value a theme assigns. The theme contract is created from it, and `ThemeValues` derived from it, so the contract and the themes cannot disagree.
 */
export const themeShape = {
  colour: {
    /** Behind everything. */
    background: null,
    /** Behind a card, a lane or a panel. */
    surface: null,
    text: null,
    /** Secondary text: lane headings, edge labels. */
    muted: null,
    border: null,
    /** Selection and links. */
    accent: null,
    /** The focus ring. */
    focus: null,
    /** The critical path. */
    critical: null,
    /** A transition that passes work between actors. */
    handoff: null,
    /** Each status, used as text and as a mark on `surface` and `background`. */
    status: {
      done: null,
      ready: null,
      blocked: null,
      skipped: null,
      unknown: null,
    } satisfies Record<Status, null>,
  },
  space: { small: null, medium: null, large: null },
  radius: { small: null, medium: null },
  font: {
    body: null,
    mono: null,
    sizeSmall: null,
    sizeBody: null,
    sizeHeading: null,
    /** The weight of labels and headings that stand out from body text. */
    weightStrong: null,
  },
  stroke: {
    /** Borders and ordinary edges. */
    thin: null,
    /** The critical path and the selection. */
    thick: null,
  },
};

/** A tree of the shape's keys with a CSS value at every leaf. */
type Assigned<Shape> = {
  readonly [Key in keyof Shape]: Shape[Key] extends null
    ? string
    : Assigned<Shape[Key]>;
};

/** Every value a theme assigns, as CSS values: one per leaf of `themeShape`, so a theme that leaves one out does not compile. */
export type ThemeValues = Assigned<typeof themeShape>;

/** What both themes share: everything but colour. */
const shared: Omit<ThemeValues, "colour"> = {
  space: { small: "0.25rem", medium: "0.5rem", large: "1rem" },
  radius: { small: "0.25rem", medium: "0.5rem" },
  font: {
    body: 'system-ui, -apple-system, "Segoe UI", sans-serif',
    mono: 'ui-monospace, "SFMono-Regular", Menlo, monospace',
    sizeSmall: "0.75rem",
    sizeBody: "0.875rem",
    sizeHeading: "1rem",
    weightStrong: "600",
  },
  stroke: { thin: "1px", thick: "3px" },
};

/** The light theme's values. Each status colour reads as text on both `surface` and `background`. */
export const lightValues: ThemeValues = {
  ...shared,
  colour: {
    background: "#ffffff",
    surface: "#f6f8fa",
    text: "#1f2328",
    muted: "#59636e",
    border: "#d1d9e0",
    accent: "#0969da",
    focus: "#0969da",
    critical: "#9a6700",
    handoff: "#6639ba",
    status: {
      done: "#1a7f37",
      ready: "#0550ae",
      blocked: "#cf222e",
      skipped: "#59636e",
      unknown: "#6639ba",
    },
  },
};

/** The dark theme's values. Each status colour reads as text on both `surface` and `background`. */
export const darkValues: ThemeValues = {
  ...shared,
  colour: {
    background: "#0d1117",
    surface: "#161b22",
    text: "#e6edf3",
    muted: "#9198a1",
    border: "#3d444d",
    accent: "#4493f8",
    focus: "#4493f8",
    critical: "#d29922",
    handoff: "#ab7df8",
    status: {
      done: "#3fb950",
      ready: "#58a6ff",
      blocked: "#f85149",
      skipped: "#9198a1",
      unknown: "#ab7df8",
    },
  },
};

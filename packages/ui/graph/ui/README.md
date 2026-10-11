# @exadev/process-graph-ui

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

Styled React components for the process model, over the headless `@exadev/process-graph-react`, and an SVG sequence diagram. Styles are written in [Vanilla Extract](https://vanilla-extract.style) and compiled when this package builds: `dist/index.js` holds plain class names and `dist/style.css` every rule, so a consumer imports the stylesheet once and needs no build plugin. A private workspace package, published as part of `process-graph`. `src/` imports nothing Node-only.

```tsx
import "@exadev/process-graph-ui/style.css";
import { ElementCard, GraphTheme, Legend } from "@exadev/process-graph-ui";

<GraphTheme theme="dark">
  <Legend critical />
  <ElementCard element={element} status="blocked" critical />
</GraphTheme>;
```

## Theme

`vars` is the theme contract (`createThemeContract`): one CSS custom property for each value in `ThemeValues` (colours, each status's colour, spacing, radii, type and stroke widths). Every style reads the contract and nothing else. `lightTheme` and `darkTheme` are the classes that assign `lightValues` and `darkValues`; `GraphTheme` puts one of them on a `div` with `surfaceRoot`, which sets the page colours and type the components inherit.

A consumer restyles the components without forking them by assigning the contract itself, in its own Vanilla Extract build:

```ts
import { createTheme } from "@vanilla-extract/css";
import { vars, lightValues } from "@exadev/process-graph-ui";

export const brandTheme = createTheme(vars, {
  ...lightValues,
  colour: { ...lightValues.colour, accent: "#7b2cbf" },
});
```

Each status colour reaches the WCAG 2.2 minimum text contrast (success criterion 1.4.3) on both the background and a surface, in both themes, and every status has its own colour; the tests compute this from the rendered themes. A status is never shown by colour alone: badges, cards and legend entries name it.

## Components

| Component         | What it is                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `GraphTheme`      | Applies `light` or `dark` to its content.                                                                                               |
| `StatusBadge`     | The status's name in its colour, outlined.                                                                                              |
| `ElementCard`     | A card whose leading edge carries the status colour, shaped by the element's kind, ringed on the critical path, outlined when selected. |
| `TransitionItem`  | A transition, in the hand-off colour when it passes work between actors and the critical colour on the critical path.                   |
| `Lane`            | A bordered swimlane with a small heading.                                                                                               |
| `Legend`          | A swatch per status in its colour, and the critical path.                                                                               |
| `FilterPanel`     | Bordered checkbox groups for status, actor and source.                                                                                  |
| `DetailPanel`     | The selected element's status, reason, blockers and impact on a raised surface.                                                         |
| `SequenceDiagram` | A sequence diagram from `toSequence`, drawn as SVG.                                                                                     |

The styled components take the same props as their headless counterparts in `@exadev/process-graph-react`, without `classNames`, and render the same markup, roles and `data-*` attributes. `badge` and `card` are the Vanilla Extract recipes behind the badge and the card, for a renderer that draws them elsewhere, such as a React Flow node. `visuallyHidden` and `focusRing` are the shared utility classes.

## Sequence diagram

`SequenceDiagram` draws a lifeline per actor in order of first appearance and a message per row: an arrow between lifelines, a loop for a self-message, an open head for an asynchronous message and a dashed line for a reply. Each fragment is a frame with its operator and the guard of each operand, nested fragments inset within it. The arrangement follows the diagram's own order, since React Flow has no lifeline layout. The drawing is hidden from assistive technology, which reads the same steps from a visually hidden nested list, and the figure is named by its `title`.

## Building

`pnpm build` runs `vite build` with `@vanilla-extract/vite-plugin` in library mode, which writes `dist/index.js` and `dist/style.css`, then `tsc -b` for the declarations. Vite empties `dist/` first, so the build info `tsc -b` keeps is written inside `dist/` too: emptying it makes the declarations build again. Every bare import stays an import. The unit tests run the same plugin with CSS processing on, so they render the real class names against the real rules.

## Commands

```sh
pnpm build          # vite build (JavaScript and CSS) and tsc -b (declarations) -> dist/
pnpm test           # unit tests in happy-dom
pnpm test:smoke     # the built dist/ and its stylesheet rendered as a real artefact
pnpm test:mutation  # Stryker
```

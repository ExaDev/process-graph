# @exadev/process-graph-react

[![GitHub](https://img.shields.io/badge/GitHub-181717?logo=github&logoColor=white)](https://github.com/ExaDev/process-graph) [![CI](https://img.shields.io/github/actions/workflow/status/ExaDev/process-graph/ci.yml?branch=main)](https://github.com/ExaDev/process-graph/actions)

Headless React hooks and unstyled function components over the process model. The hooks load and follow a model from a `GraphStore` client, derive its run with `@exadev/process-graph-domain`, project its views with `@exadev/process-graph-projection`, and hold selection and filter state. The components render semantic markup with ARIA roles and stable `data-*` attributes and take a class for each of their parts; they carry no styles and depend on no renderer. A private workspace package, published as part of `process-graph`. `src/` imports nothing Node-only.

```tsx
import {
  ElementCard,
  noFacts,
  useBlockers,
  useGraphSelection,
  useModel,
  useStatuses,
} from "@exadev/process-graph-react";

const Board = ({ client }) => {
  const state = useModel(client, "release");
  if (state.status !== "loaded") return null;
  const { model, overlay } = state.stored;
  return <Cards run={{ model, overlay, facts: noFacts }} />;
};

const Cards = ({ run }) => {
  const statuses = useStatuses(run);
  const blockers = useBlockers(run);
  const selection = useGraphSelection(run.model.elements.map((e) => e.id));
  return (
    <div aria-label="Work" {...selection.containerProps}>
      {run.model.elements.map((element) => {
        const status = statuses.get(element.id);
        return status === undefined ? null : (
          <ElementCard
            key={element.id}
            element={element}
            status={status}
            blockedBy={blockers
              .get(element.id)
              ?.map((id) => ({ id, label: id }))}
            item={selection.itemProps(element.id)}
          />
        );
      })}
    </div>
  );
};
```

## Hooks

| Hook                                 | Result                                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `useModel(client, modelId)`          | `loading`, then `loaded` with the stored model, overlay and revision, `missing` while the store has no such model, or `failed` with the error. |
| `useStatuses(run)`                   | Every element's `Status`, by `deriveStatuses`.                                                                                                 |
| `useReadySet(run)`                   | The ready elements, by `readySet`.                                                                                                             |
| `useBlockedChain(run, id)`           | The chain of unfinished work behind an element and the blockers at its end.                                                                    |
| `useBlockers(run)`                   | Each blocked element's blockers, for a view that shows them beside every element.                                                              |
| `useImpact(run, id)`                 | The live work downstream of an element, by `impact`.                                                                                           |
| `useWhyStatus(run, id)`              | The `StatusExplanation` of an element, by `explainStatus`.                                                                                     |
| `useCriticalPath(run, weight?)`      | The heaviest chain through the work ahead; each element weighs one step unless `weight` says otherwise.                                        |
| `useProjection(model, projection)`   | The view a projection names, as `{ notation, view }`.                                                                                          |
| `useElementFilter(initial?)`         | A filter by status, actor and source, with toggles and `clear`.                                                                                |
| `useGraphSelection(order, options?)` | The selected element, a setter, and container and item props for keyboard navigation.                                                          |

A `Run` is `{ model, overlay, facts }`. `noFacts` is the facts port of a run with no facts source: every condition that reads a fact is indeterminate. Keep the three parts stable between renders; the hooks recompute when one of them changes identity. A hook that derives status throws what `graph-domain` throws (an illegal cycle, an unknown element), so an error boundary shows it.

### Following a store

`useModel` takes any `GraphStore` client from `@exadev/process-graph-store-contract`: an in-process router client, one over a `MessagePort` to the SQLite worker, or one over HTTP. It subscribes to the model's changes before loading it, loads again on every change newer than what it shows, and aborts both when the component unmounts or the client or model id changes. A model the store does not have, yet or any more, is `missing` and still followed, so the write that creates it (a sync, a save) loads it; any other error ends in `failed`.

### Filtering

An `ElementFilter` holds a set of statuses, actors and sources; an empty set does not constrain, so the empty filter shows everything. `filterElements` gives the shown elements in model order, `matchesFilter` tests one, and `filterOptions` lists the actors and source collections a model offers. A source collection is a source-qualified identifier up to its item number (`sourceScope("github:org/repo#12")` is `github:org/repo`). An element with no actor or no source never matches a non-empty actor or source set.

### Keyboard navigation

`useGraphSelection(order)` follows the WAI-ARIA listbox pattern. Spread `containerProps` on the element that holds the items and `itemProps(id)` on each item. The arrow keys move the selection through `order`, wrapping at either end; Home and End go to the first and last; Escape clears the selection. Only one item is a tab stop, the selected one or the first, and a keyboard move focuses the item it selects. Pass the order in which the items are drawn, after filtering. The options set the initial selection, an `onChange` listener called with each selection a click or key makes, and a `focus` function for a renderer that draws its own focusable items, such as a React Flow canvas. An owner that keeps the selection itself, so that several views of one model share it, passes it as `selected` (the key present, even when no element is selected): the hook then reads the selection from there, keeps none of its own, and only reports through `onChange` what a click or key asks for.

## Components

| Component        | Markup                                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `StatusBadge`    | A `span` with the status's label and `data-status`.                                                                                              |
| `ElementCard`    | The element's label, status badge, a critical path marker and "Blocked by" text; `data-element-id`, `data-kind`, `data-status`, `data-critical`. |
| `TransitionItem` | An `li` reading "from to to", with its label and a hand-off marker; `data-transition-id`, `data-handoff`, `data-critical`.                       |
| `Lane`           | A group named by its heading, holding one participant's work; `data-lane`.                                                                       |
| `Legend`         | A list named "Legend" with a swatch and label per status, and optionally the critical path; `data-status` on each item and swatch.               |
| `FilterPanel`    | A search form of checkbox groups for status, actor and source, and a clear button; `data-filter` on each group.                                  |
| `DetailPanel`    | A complementary region named by the element: its status, the rule that decided it, and its blockers and impact as sections.                      |

Every component takes `classNames`, a class per named part (`ElementCardPart`, `LegendPart` and so on), or `className` for a single-part one. Each inner part also carries `data-part`. `statusLabels`, `ruleDescriptions` and `elementLabel` are the texts the components use, for a renderer that draws the same things another way.

## Commands

```sh
pnpm build          # tsc -b -> dist/ (ESM + .d.ts)
pnpm test           # unit tests in happy-dom
pnpm test:smoke     # the built dist/ rendered as a real artefact
pnpm test:mutation  # Stryker
```

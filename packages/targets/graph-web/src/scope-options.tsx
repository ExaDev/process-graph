import {
  filterStates,
  orderFields,
  type FilterState,
  type OrderField,
  type SyncFilter,
} from "@exadev/process-graph-source-contract";
import { useId, useState, type ReactElement, type SubmitEvent } from "react";
import {
  button,
  chip,
  chipList,
  field,
  input,
  muted,
  row,
  section,
  sectionHeading,
} from "./app.css.ts";
import {
  syncDirectionNames,
  syncDirectionOf,
  syncDirections,
  type SyncDirection,
} from "./url-state.ts";

export interface ScopeOptionsProps {
  /** What the sync reads of each scope; absent to read everything in the source's own order. */
  readonly filter: SyncFilter | undefined;
  /** Whether a scope is a Projects v2 board, which GitHub cannot filter. */
  readonly hasBoard: boolean;
  /** Called with the new filter, or nothing when it no longer narrows or orders anything. */
  readonly onChange: (filter: SyncFilter | undefined) => void;
}

const stateLabels: Readonly<Record<FilterState, string>> = {
  open: "Open",
  done: "Done",
};

const orderLabels: Readonly<Record<OrderField, string>> = {
  created: "When created",
  updated: "When last updated",
  comments: "How much discussion",
};

const directionLabels: Readonly<Record<SyncDirection, string>> = {
  asc: "Ascending",
  desc: "Descending",
};

/** The select's value for the source's own order. */
const sourceOrder = "";

const isMember = <T extends string>(
  values: readonly T[],
  value: string,
): value is T => values.some((candidate) => candidate === value);

/** The parts of a filter the control edits. */
interface FilterParts {
  /** The run states to keep; none keeps every state. */
  readonly states: readonly FilterState[];
  /** The labels to keep issues carrying any of; none keeps every issue. */
  readonly labels: readonly string[];
  /** The order to list them in; absent for the source's own. */
  readonly order: SyncFilter["order"];
}

/**
 * A filter from its parts, leaving out each part that narrows or orders nothing, and nothing at all when no part does.
 * @param parts - The states, labels and order.
 */
const filterOf = (parts: FilterParts): SyncFilter | undefined => {
  const filter: SyncFilter = {
    ...(parts.states.length === 0 ? {} : { states: parts.states }),
    ...(parts.labels.length === 0 ? {} : { labels: parts.labels }),
    ...(parts.order === undefined ? {} : { order: parts.order }),
  };

  return Object.keys(filter).length === 0 ? undefined : filter;
};

/**
 * What the sync reads of each scope: issues in some run states only, issues carrying any of some labels only, and the order the source lists them in, as the command line's `sync --state --label --order --direction` gives them. The choices are part of the link. They narrow what each scope lists, not the work it depends on, and GitHub refuses to filter a Projects v2 board, which the control says when a board is in the scope.
 * @param props - The filter, whether a board is in the scope, and the change listener.
 * @returns The control.
 */
export const ScopeOptions = (props: ScopeOptionsProps): ReactElement => {
  const { filter, hasBoard, onChange } = props;
  const [draft, setDraft] = useState("");
  const headingId = useId();
  const labelId = useId();
  const orderId = useId();
  const directionId = useId();
  const states = filter?.states ?? [];
  const labels = filter?.labels ?? [];
  const order = filter?.order;
  const change = (next: Partial<FilterParts>): void => {
    onChange(filterOf({ states, labels, order, ...next }));
  };

  const addLabel = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const label = draft.trim();
    setDraft("");
    if (label !== "" && !labels.includes(label)) {
      change({ labels: [...labels, label] });
    }
  };

  return (
    <section
      aria-labelledby={headingId}
      className={section}
      data-screen="scope-options"
    >
      <h2 id={headingId} className={sectionHeading}>
        What to read
      </h2>
      <p className={muted}>
        Narrows what each scope lists and orders it. Work the listed issues
        depend on is read whatever its state or labels.
      </p>
      <fieldset className={row}>
        <legend>Issue state</legend>
        {filterStates.map((state) => (
          <label key={state}>
            <input
              type="checkbox"
              checked={states.includes(state)}
              onChange={(event) => {
                change({
                  states: event.target.checked
                    ? filterStates.filter(
                        (kept) => kept === state || states.includes(kept),
                      )
                    : states.filter((kept) => kept !== state),
                });
              }}
            />{" "}
            {stateLabels[state]}
          </label>
        ))}
      </fieldset>
      <form className={field} onSubmit={addLabel}>
        <label htmlFor={labelId}>Only issues with any of these labels</label>
        {labels.length === 0 ? null : (
          <ul aria-label="Labels" className={chipList}>
            {labels.map((label) => (
              <li key={label} className={chip} data-label={label}>
                {label}
                <button
                  type="button"
                  className={button}
                  aria-label={`Remove the label ${label}`}
                  onClick={() => {
                    change({ labels: labels.filter((kept) => kept !== label) });
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={row}>
          <input
            id={labelId}
            className={input}
            spellCheck={false}
            autoCapitalize="off"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
            }}
          />
          <button type="submit" className={button}>
            Add label
          </button>
        </div>
      </form>
      <div className={row}>
        <label htmlFor={orderId}>Order</label>
        <select
          id={orderId}
          className={input}
          value={order?.field ?? sourceOrder}
          onChange={(event) => {
            const { value } = event.target;
            change({
              order: isMember(orderFields, value)
                ? {
                    field: value,
                    direction: order?.direction ?? syncDirections.asc,
                  }
                : undefined,
            });
          }}
        >
          <option value={sourceOrder}>As the source lists them</option>
          {orderFields.map((value) => (
            <option key={value} value={value}>
              {orderLabels[value]}
            </option>
          ))}
        </select>
        <label htmlFor={directionId}>Direction</label>
        <select
          id={directionId}
          className={input}
          disabled={order === undefined}
          value={syncDirectionOf(order?.direction ?? syncDirections.asc)}
          onChange={(event) => {
            const { value } = event.target;
            if (order !== undefined && isMember(syncDirectionNames, value)) {
              change({
                order: { field: order.field, direction: syncDirections[value] },
              });
            }
          }}
        >
          {syncDirectionNames.map((value) => (
            <option key={value} value={value}>
              {directionLabels[value]}
            </option>
          ))}
        </select>
      </div>
      {hasBoard && filter !== undefined ? (
        <p role="note" className={muted} data-note="board-filter">
          GitHub cannot filter or reorder a Projects v2 board, so a sync of
          these scopes with these options will be refused. Clear them to sync
          the board.
        </p>
      ) : null}
    </section>
  );
};

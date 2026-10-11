import { statuses, type Status } from "@exadev/process-graph-domain";
import type { ReactElement } from "react";
import type { ElementFilter, FilterOption, FilterOptions } from "./filter.ts";
import { statusLabels } from "./labels.ts";

/** The parts of a filter panel a class can be given to. */
export type FilterPanelPart =
  "root" | "group" | "legend" | "option" | "checkbox" | "clear";

export interface FilterPanelProps {
  readonly filter: ElementFilter;
  /** The actors and sources to offer, from `filterOptions`. A group with no options is not shown. */
  readonly options: FilterOptions;
  /** The statuses to offer. Defaults to every status. */
  readonly statuses?: readonly Status[] | undefined;
  readonly onToggleStatus: (status: Status) => void;
  readonly onToggleActor: (actor: string) => void;
  readonly onToggleSource: (source: string) => void;
  readonly onClear: () => void;
  readonly classNames?: Partial<Record<FilterPanelPart, string>> | undefined;
}

interface GroupProps<V extends string> {
  readonly name: string;
  readonly legend: string;
  readonly options: readonly FilterOption<V>[];
  readonly checked: ReadonlySet<V>;
  readonly onToggle: (value: V) => void;
  readonly classNames: Partial<Record<FilterPanelPart, string>>;
}

const Group = <V extends string>({
  name,
  legend,
  options,
  checked,
  onToggle,
  classNames,
}: GroupProps<V>): ReactElement | null =>
  options.length === 0 ? null : (
    <fieldset className={classNames.group} data-filter={name}>
      <legend className={classNames.legend}>{legend}</legend>
      {options.map((option) => (
        <label key={option.value} className={classNames.option}>
          <input
            type="checkbox"
            className={classNames.checkbox}
            value={option.value}
            checked={checked.has(option.value)}
            onChange={() => {
              onToggle(option.value);
            }}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );

/**
 * Checkboxes for filtering a view by status, actor and source, and a button that clears them. Each group is a `fieldset` carrying `data-filter` with `status`, `actor` or `source`.
 * @param props - The current filter, what to offer, and the handlers that change it.
 * @returns A search form.
 */
export const FilterPanel = (props: FilterPanelProps): ReactElement => {
  const {
    filter,
    options,
    statuses: offered = statuses,
    onToggleStatus,
    onToggleActor,
    onToggleSource,
    onClear,
    classNames = {},
  } = props;

  return (
    <form
      role="search"
      aria-label="Filter elements"
      className={classNames.root}
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <Group
        name="status"
        legend="Status"
        options={offered.map((status) => ({
          value: status,
          label: statusLabels[status],
        }))}
        checked={filter.statuses}
        onToggle={onToggleStatus}
        classNames={classNames}
      />
      <Group
        name="actor"
        legend="Actor"
        options={options.actors}
        checked={filter.actors}
        onToggle={onToggleActor}
        classNames={classNames}
      />
      <Group
        name="source"
        legend="Source"
        options={options.sources}
        checked={filter.sources}
        onToggle={onToggleSource}
        classNames={classNames}
      />
      <button type="button" className={classNames.clear} onClick={onClear}>
        Clear filters
      </button>
    </form>
  );
};

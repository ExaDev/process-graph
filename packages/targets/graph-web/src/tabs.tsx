import { useId, useRef, type KeyboardEvent, type ReactElement } from "react";
import { tab as tabClass, tabList } from "./app.css.ts";

/** One tab: its value and the text it is shown with. */
interface TabOption<V extends string> {
  readonly value: V;
  readonly label: string;
}

export interface TabsProps<V extends string> {
  /** The tab list's accessible name. */
  readonly label: string;
  readonly options: readonly TabOption<V>[];
  readonly selected: V;
  readonly onSelect: (value: V) => void;
  /** The identifier of the panel the tabs control, so each tab names it in `aria-controls`. */
  readonly panelId: string;
}

/** The tab a key moves to from position `index`, or `undefined` for a key the tabs do not handle. */
const moved = (
  key: string,
  index: number,
  count: number,
): number | undefined => {
  if (key === "ArrowRight") {
    return (index + 1) % count;
  }
  if (key === "ArrowLeft") {
    return (index - 1 + count) % count;
  }
  if (key === "Home") {
    return 0;
  }

  return key === "End" ? count - 1 : undefined;
};

/**
 * A row of tabs following the WAI-ARIA tabs pattern with automatic activation: the selected tab is the one tab stop, and the arrow keys, Home and End select and focus another.
 * @param props - The tab list's name, its options, the selected value, the listener and the controlled panel's id.
 * @returns The tab list.
 */
export const Tabs = <V extends string>(props: TabsProps<V>): ReactElement => {
  const { label, options, selected, onSelect, panelId } = props;
  const prefix = useId();
  const list = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const index = options.findIndex((option) => option.value === selected);
    const next = moved(event.key, index, options.length);
    const option = next === undefined ? undefined : options[next];
    if (option === undefined || next === undefined) {
      return;
    }
    event.preventDefault();
    onSelect(option.value);
    const button =
      list.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next];
    button?.focus();
  };

  return (
    <div ref={list} role="tablist" aria-label={label} className={tabList}>
      {options.map((option) => {
        const active = option.value === selected;

        return (
          <button
            key={option.value}
            id={`${prefix}-${option.value}`}
            type="button"
            role="tab"
            className={tabClass}
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={active ? 0 : -1}
            onKeyDown={onKeyDown}
            onClick={() => {
              onSelect(option.value);
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
};

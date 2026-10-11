import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type RefCallback,
} from "react";

/** Props for the element that holds the selectable items: a listbox that moves the selection with the keyboard. */
export interface SelectionContainerProps {
  readonly role: "listbox";
  readonly onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
}

/** Props for one selectable item: an option with a roving tab stop, selected by a click. */
export interface SelectionItemProps {
  readonly role: "option";
  readonly ref: RefCallback<HTMLElement>;
  readonly tabIndex: 0 | -1;
  readonly "aria-selected": boolean;
  readonly onClick: () => void;
}

/** The selected element of a view, how to change it, and the props that make a set of items keyboard navigable. */
export interface GraphSelection<Id extends string> {
  /** The selected element, or `undefined` when none is or the selected one is no longer in `order`. */
  readonly selected: Id | undefined;
  readonly select: (id: Id | undefined) => void;
  readonly containerProps: SelectionContainerProps;
  /** The props for the item of one element, to spread on it. */
  readonly itemProps: (id: Id) => SelectionItemProps;
}

/** What each navigation key does, given the items in order and the index of the selected one (-1 when none is). */
const moves: Readonly<
  Record<string, (count: number, at: number) => number | undefined>
> = {
  ArrowDown: (count, at) => (at + 1) % count,
  ArrowRight: (count, at) => (at + 1) % count,
  ArrowUp: (count, at) => (at <= 0 ? count : at) - 1,
  ArrowLeft: (count, at) => (at <= 0 ? count : at) - 1,
  Home: () => 0,
  End: (count) => count - 1,
  Escape: () => undefined,
};

/**
 * Selection state with keyboard navigation over the elements of a view, following the listbox pattern of the WAI-ARIA Authoring Practices: the arrow keys move the selection to the next or previous element in `order`, wrapping at either end; Home and End move to the first and last; Escape clears it. Only one item is a tab stop: the selected one, or the first when none is. A keyboard move also focuses the item it selects.
 * @param order - The navigable elements, in the order the keys move through them: the elements on show, after filtering.
 * @param initial - The element selected at first.
 * @returns The selection, a setter, and the container and item props.
 */
export const useGraphSelection = <Id extends string>(
  order: readonly Id[],
  initial?: Id,
): GraphSelection<Id> => {
  const [chosen, select] = useState<Id | undefined>(initial);
  const items = useRef(new Map<Id, HTMLElement>());
  const selected =
    chosen !== undefined && order.includes(chosen) ? chosen : undefined;
  const stop = selected ?? order[0];

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      const move = moves[event.key];
      if (move === undefined || order.length === 0) {
        return;
      }
      event.preventDefault();
      const index = move(
        order.length,
        selected === undefined ? -1 : order.indexOf(selected),
      );
      const next = index === undefined ? undefined : order[index];
      select(next);
      if (next !== undefined) {
        // An item rendered without its props, as on a canvas that manages its own focus, has no element to focus.
        items.current.get(next)?.focus();
      }
    },
    [order, selected],
  );

  const itemProps = useCallback(
    (id: Id): SelectionItemProps => ({
      role: "option",
      ref: (element) => {
        if (element !== null) {
          items.current.set(id, element);
        }

        return () => {
          items.current.delete(id);
        };
      },
      tabIndex: id === stop ? 0 : -1,
      "aria-selected": id === selected,
      onClick: () => {
        select(id);
      },
    }),
    [selected, stop],
  );

  return useMemo(
    () => ({
      selected,
      select,
      containerProps: { role: "listbox", onKeyDown },
      itemProps,
    }),
    [selected, onKeyDown, itemProps],
  );
};

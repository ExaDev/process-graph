import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { AddressBar, Observable } from "./ports.ts";
import {
  parseViewState,
  serialiseViewState,
  type ParsedViewState,
  type ViewState,
} from "./url-state.ts";

/**
 * Reads an observable's current value and re-renders when it changes.
 * @param observable - The value to follow. Keep it stable between renders.
 * @returns The current value.
 */
export const useObservable = <T>(observable: Observable<T>): T =>
  useSyncExternalStore(observable.subscribe, observable.get);

/** The view state read from the address, and the function that changes it. */
export interface ViewStateHandle extends ParsedViewState {
  /** Applies a change to the view state and writes the result to the address. */
  readonly update: (change: (state: ViewState) => ViewState) => void;
}

/**
 * Follows the view state in the page address: every change is written back to the address, so the address is always a link to what is on screen.
 * @param address - The address bar port. Keep it stable between renders.
 * @returns The state, what in the address could not be used, and `update`.
 */
export const useViewState = (address: AddressBar): ViewStateHandle => {
  const search = useObservable(address.search);
  const parsed = useMemo(() => parseViewState(search), [search]);
  const update = useCallback(
    (change: (state: ViewState) => ViewState) => {
      address.replace(
        serialiseViewState(change(parseViewState(address.search.get()).state)),
      );
    },
    [address],
  );

  return { ...parsed, update };
};

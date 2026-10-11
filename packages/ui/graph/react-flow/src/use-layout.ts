import {
  layout,
  type LayoutOptions,
  type LayoutResult,
  type LayoutView,
} from "@exadev/process-graph-layout";
import type { IdSpace } from "@exadev/process-graph-schema";
import { useEffect, useState } from "react";

/** Where laying out a view stands. */
export type LayoutState<I extends IdSpace> =
  | { readonly status: "pending" }
  | { readonly status: "placed"; readonly result: LayoutResult<I> }
  | { readonly status: "failed"; readonly error: unknown };

/** The layout options a view is laid out with: everything `layout` takes but the signal, which the hook owns. */
export type FlowLayoutOptions = Omit<LayoutOptions, "signal">;

const pending = { status: "pending" } as const;

/**
 * Lays out a view with `graph-layout`'s `layout`, again whenever the view or the options change, aborting a layout that is no longer wanted.
 * @param view - The flowchart, swimlane or state machine to place. Keep it stable between renders.
 * @param options - Direction, spacing and the engine. Keep it stable between renders.
 * @returns `pending` until the layout resolves, then `placed` with the positions, sizes and lanes, or `failed` with what the engine threw.
 */
export const useLayout = <I extends IdSpace>(
  view: LayoutView<I>,
  options: FlowLayoutOptions,
): LayoutState<I> => {
  const [state, setState] = useState<{
    readonly view: LayoutView<I>;
    readonly options: FlowLayoutOptions;
    readonly value: LayoutState<I>;
  }>({ view, options, value: pending });

  useEffect(() => {
    const controller = new AbortController();
    const settle = (value: LayoutState<I>): void => {
      setState({ view, options, value });
    };
    layout(view, { ...options, signal: controller.signal }).then(
      (result) => {
        settle({ status: "placed", result });
      },
      (error: unknown) => {
        // An abort is this effect being cleaned up, not a failed layout.
        if (!controller.signal.aborted) {
          settle({ status: "failed", error });
        }
      },
    );

    return () => {
      controller.abort();
    };
  }, [view, options]);

  return state.view === view && state.options === options
    ? state.value
    : pending;
};

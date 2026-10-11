import type { Direction } from "@exadev/process-graph-layout";
import {
  toFlowchart,
  toStateMachine,
  toSwimlane,
} from "@exadev/process-graph-projection";
import {
  emptyFilter,
  filterElements,
  useBlockers,
  useCriticalPath,
  useGraphSelection,
  useStatuses,
  type ElementFilter,
  type Run,
} from "@exadev/process-graph-react";
import type { IdSpace, Projection } from "@exadev/process-graph-schema";
import { ReactFlow, type ColorMode } from "@xyflow/react";
import { useCallback, useMemo, useRef, type ReactElement } from "react";
import { edgeTypes } from "./edges.tsx";
import { toFlow, type FlowView } from "./flow.ts";
import { nodeTypes } from "./nodes.tsx";
import { useLayout, type FlowLayoutOptions } from "./use-layout.ts";

/** A projection React Flow can draw: anything but a sequence diagram, which `SequenceDiagram` draws. */
export type FlowProjection<I extends IdSpace> = Exclude<
  Projection<I>,
  { readonly notation: "sequence" }
>;

/** The direction a view is laid out in when its options name none: edges point right, as `graph-layout`'s own default. */
const defaultDirection: Direction = "right";

const projectFlow = <I extends IdSpace>(
  run: Run<I>,
  projection: FlowProjection<I>,
): FlowView<I> => {
  if (projection.notation === "stateMachine") {
    return {
      notation: "stateMachine",
      view: toStateMachine(run.model, projection.subject),
    };
  }

  return projection.notation === "swimlane"
    ? { notation: "swimlane", view: toSwimlane(run.model) }
    : { notation: "flowchart", view: toFlowchart(run.model) };
};

export interface ProcessFlowProps<I extends IdSpace> {
  /** The model, its overlay and facts. Keep each part stable between renders. */
  readonly run: Run<I>;
  /** The view to draw: a flowchart, a swimlane or a state machine. Keep it stable between renders. */
  readonly projection: FlowProjection<I>;
  /** The canvas's accessible name. */
  readonly label: string;
  /** Direction, spacing and the layout engine, passed to `graph-layout`. The engine defaults to elkjs; a test injects a stub. Keep it stable between renders. */
  readonly layout?: FlowLayoutOptions | undefined;
  /** Which elements to show. Defaults to all of them. */
  readonly filter?: ElementFilter | undefined;
  /** React Flow's own colour mode, for its controls and background. Pair it with the graph-ui theme around the view. */
  readonly colorMode?: ColorMode | undefined;
  /** Called with each element a click or key selects, and with `undefined` when the selection is cleared. */
  readonly onSelect?: ((id: I["element"] | undefined) => void) | undefined;
  /**
   * The selected element, when the owner keeps the selection, as `useGraphSelection`'s option of the same name: give the key, even as `undefined`, and the canvas shows this selection and reports through `onSelect` what a click or key asks for, so the canvas and other views of the model share one selection. Leave it out for the canvas to keep its own.
   */
  readonly selected?: I["element"] | undefined;
}

/**
 * A process view on a React Flow canvas: the projection laid out by `graph-layout`, each element as a styled card with its status and what blocks it, lanes as group nodes in a swimlane, and the critical path's elements and steps highlighted. Elements are selected by a click, or with the arrow, Home, End and Escape keys once the canvas has focus; the filter hides elements and the edges that touch them. Nothing is drawn until the layout resolves, and a layout that fails throws to the nearest error boundary.
 * @param props - The run, the projection, a label, and optionally the layout, a filter, the colour mode and a selection listener.
 * @returns The canvas, which fills its container.
 */
export const ProcessFlow = <I extends IdSpace>(
  props: ProcessFlowProps<I>,
): ReactElement => {
  const {
    run,
    projection,
    label,
    layout,
    filter = emptyFilter,
    colorMode,
    onSelect,
  } = props;
  const direction = layout?.direction ?? defaultDirection;
  const options = useMemo(
    () => ({ ...layout, direction }),
    [layout, direction],
  );
  const flow = useMemo(() => projectFlow(run, projection), [run, projection]);
  const placement = useLayout(flow.view, options);
  const statuses = useStatuses(run);
  const blockers = useBlockers(run);
  const { path } = useCriticalPath(run);
  const shown = useMemo(
    () => filterElements(run.model, statuses, filter),
    [run.model, statuses, filter],
  );
  const canvas = useRef<HTMLDivElement>(null);
  const focus = useCallback((id: string) => {
    const node = canvas.current?.querySelector(
      `.react-flow__node[data-id="${CSS.escape(id)}"]`,
    );
    if (node instanceof HTMLElement) {
      node.focus();
    }
  }, []);
  const { selected, select, containerProps } = useGraphSelection(shown, {
    onChange: onSelect,
    focus,
    ...("selected" in props ? { selected: props.selected } : {}),
  });

  const drawn = useMemo(() => {
    if (placement.status !== "placed") {
      return undefined;
    }

    return toFlow(flow, placement.result, {
      model: run.model,
      statuses,
      criticalPath: path,
      blockers,
      shown: new Set(shown),
      direction,
    });
  }, [flow, placement, run.model, statuses, path, blockers, shown, direction]);

  if (placement.status === "failed") {
    throw new Error(`${label} could not be laid out`, {
      cause: placement.error,
    });
  }
  if (drawn === undefined) {
    return <p role="status">Laying out {label}</p>;
  }

  return (
    <ReactFlow
      ref={canvas}
      aria-label={label}
      nodes={drawn.nodes.map((node) =>
        node.id === selected ? { ...node, selected: true } : node,
      )}
      edges={drawn.edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      {...(colorMode === undefined ? {} : { colorMode })}
      nodesDraggable={false}
      nodesConnectable={false}
      fitView
      onKeyDown={containerProps.onKeyDown}
      onNodeClick={(_event, node) => {
        if (node.type === "element") {
          select(node.id);
        }
      }}
      onPaneClick={() => {
        select(undefined);
      }}
    />
  );
};

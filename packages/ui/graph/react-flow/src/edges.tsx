import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react";
import type { ReactElement } from "react";
import type { TransitionEdge } from "./flow.ts";
import { criticalEdge, handoffEdge, transitionEdge } from "./flow.css.ts";

/**
 * A transition: a stepped line with an arrowhead and its label, coloured as a hand-off or a step of the critical path. Its group carries `data-transitions` with the model transitions it stands for, and `data-handoff` and `data-critical` as they apply.
 * @param props - The edge React Flow renders, with the transition's data.
 * @returns The edge's SVG.
 */
export const TransitionEdgeView = (
  props: EdgeProps<TransitionEdge>,
): ReactElement => {
  const {
    id,
    data,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    markerEnd,
  } = props;
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const classes = [
    transitionEdge,
    data?.handoff === true ? handoffEdge : undefined,
    data?.critical === true ? criticalEdge : undefined,
  ].filter((name) => name !== undefined);

  return (
    <g
      className={classes.join(" ")}
      data-transitions={data?.transitions.join(" ")}
      data-handoff={data?.handoff === true ? "" : undefined}
      data-critical={data?.critical === true ? "" : undefined}
    >
      <BaseEdge
        id={id}
        path={path}
        {...(markerEnd === undefined ? {} : { markerEnd })}
        label={data?.label}
        labelX={labelX}
        labelY={labelY}
      />
    </g>
  );
};

/** The edge components, by edge type. Defined once, outside any component, as React Flow requires. */
export const edgeTypes = {
  transition: TransitionEdgeView,
};

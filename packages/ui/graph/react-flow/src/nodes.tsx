import type { IdSpace } from "@exadev/process-graph-schema";
import { ElementCard, Lane } from "@exadev/process-graph-ui";
import { Handle, type NodeProps } from "@xyflow/react";
import type { ReactElement } from "react";
import type { ElementNode, LaneNode } from "./flow.ts";
import { elementNode, handle, laneNode } from "./flow.css.ts";

/**
 * An element of a process view: graph-ui's element card, with the handles React Flow routes edges to.
 * @param props - The node React Flow renders, with the element's data.
 * @returns The node's content.
 */
export const ElementNodeView = (
  props: NodeProps<ElementNode<IdSpace>>,
): ReactElement => {
  const { data, sourcePosition, targetPosition, selected } = props;

  return (
    <div className={elementNode} data-selected={selected ? "" : undefined}>
      {targetPosition === undefined ? null : (
        <Handle
          type="target"
          position={targetPosition}
          isConnectable={false}
          className={handle}
        />
      )}
      <ElementCard
        element={data.element}
        status={data.status}
        critical={data.critical}
        blockedBy={data.blockedBy}
      />
      {sourcePosition === undefined ? null : (
        <Handle
          type="source"
          position={sourcePosition}
          isConnectable={false}
          className={handle}
        />
      )}
    </div>
  );
};

/**
 * A swimlane: graph-ui's lane, filling the group node that holds its participant's elements.
 * @param props - The node React Flow renders, with the lane's data.
 * @returns The node's content.
 */
export const LaneNodeView = (props: NodeProps<LaneNode>): ReactElement => {
  const { data } = props;

  return (
    <div className={laneNode}>
      <Lane participant={data.participant} label={data.label} />
    </div>
  );
};

/** The node components, by node type. Defined once, outside any component, as React Flow requires. */
export const nodeTypes = {
  element: ElementNodeView,
  lane: LaneNodeView,
};

import type {
  EngineBox,
  EngineGraph,
  EngineNode,
  LayoutEngine,
} from "@exadev/process-graph-layout";

/**
 * A layout engine that needs no elkjs: it puts every leaf in one row, in the order the request lists them, each a layer gap after the one before, and wraps each group around its children with the request's padding. It records every request, so a test can see what was asked.
 * @returns The engine and the requests it received.
 */
export const stubEngine = (): {
  readonly engine: LayoutEngine;
  readonly requests: EngineGraph[];
} => {
  const requests: EngineGraph[] = [];
  const engine: LayoutEngine = {
    arrange: async (graph) => {
      requests.push(graph);
      const boxes: EngineBox[] = [];
      let x = 0;
      const leaf = (node: EngineNode): EngineBox => {
        const box = {
          id: node.id,
          x,
          y: graph.groupPadding,
          width: node.width,
          height: node.height,
        };
        x += node.width + graph.layerGap;

        return box;
      };
      for (const node of graph.nodes) {
        // A leaf, or a group with nothing in it, takes its own size in the row.
        if (node.children === undefined || node.children.length === 0) {
          boxes.push(leaf(node));
          continue;
        }
        const children = node.children.map(leaf);
        const left =
          Math.min(...children.map((child) => child.x)) - graph.groupPadding;
        const right =
          Math.max(...children.map((child) => child.x + child.width)) +
          graph.groupPadding;
        const bottom =
          Math.max(...children.map((child) => child.y + child.height)) +
          graph.groupPadding;
        boxes.push(
          { id: node.id, x: left, y: 0, width: right - left, height: bottom },
          ...children,
        );
      }

      return Promise.resolve(boxes);
    },
  };

  return { engine, requests };
};

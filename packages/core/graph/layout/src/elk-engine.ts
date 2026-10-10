import ELK, {
  type ElkExtendedEdge,
  type ElkNode,
  type LayoutOptions,
} from "elkjs/lib/elk.bundled.js";
import type {
  Direction,
  EngineBox,
  EngineGraph,
  EngineNode,
  LayoutEngine,
} from "./engine.ts";

/**
 * Fixes ELK's randomised tie-breaking, so the same graph always yields the same boxes. ELK's own default is the same value; it is set explicitly so a change of default cannot make output depend on the library version.
 */
const RANDOM_SEED = "1";

const elkDirection: Readonly<Record<Direction, string>> = {
  right: "RIGHT",
  down: "DOWN",
  left: "LEFT",
  up: "UP",
};

const toElkNode = (node: EngineNode, groupPadding: number): ElkNode => {
  if (node.children === undefined) {
    return { id: node.id, width: node.width, height: node.height };
  }
  const layoutOptions: LayoutOptions = {
    "elk.padding": `[top=${groupPadding},left=${groupPadding},bottom=${groupPadding},right=${groupPadding}]`,
    "elk.nodeSize.constraints": "MINIMUM_SIZE",
    "elk.nodeSize.minimum": `(${node.width},${node.height})`,
  };

  return {
    id: node.id,
    layoutOptions,
    children: node.children.map((child) => toElkNode(child, groupPadding)),
  };
};

/** Flattens ELK's parent-relative coordinates into absolute boxes, outermost nodes first. */
const flatten = (root: ElkNode): readonly EngineBox[] => {
  const boxes: EngineBox[] = [];
  const stack: {
    readonly node: ElkNode;
    readonly x: number;
    readonly y: number;
  }[] = [];
  for (const child of root.children ?? []) {
    stack.push({ node: child, x: 0, y: 0 });
  }
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { node, x: originX, y: originY } = next;
    const x = originX + (node.x ?? 0);
    const y = originY + (node.y ?? 0);
    boxes.push({
      id: node.id,
      x,
      y,
      width: node.width ?? 0,
      height: node.height ?? 0,
    });
    for (const child of node.children ?? []) {
      stack.push({ node: child, x, y });
    }
  }

  return boxes;
};

/**
 * The default engine: elkjs's layered algorithm, run in the calling context from the bundled build so it needs neither a Worker nor Node-only modules. Groups are laid out together with their children (`INCLUDE_CHILDREN`), so an edge between lanes takes part in layer assignment.
 */
export const createElkEngine = (): LayoutEngine => {
  const elk = new ELK();

  return {
    async arrange(graph: EngineGraph): Promise<readonly EngineBox[]> {
      const edges: ElkExtendedEdge[] = graph.edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      }));
      const root: ElkNode = {
        id: "root",
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": elkDirection[graph.direction],
          "elk.spacing.nodeNode": String(graph.nodeGap),
          "elk.layered.spacing.nodeNodeBetweenLayers": String(graph.layerGap),
          "elk.hierarchyHandling": "INCLUDE_CHILDREN",
          "elk.randomSeed": RANDOM_SEED,
        },
        children: graph.nodes.map((node) =>
          toElkNode(node, graph.groupPadding),
        ),
        edges,
      };

      return flatten(await elk.layout(root));
    },
  };
};

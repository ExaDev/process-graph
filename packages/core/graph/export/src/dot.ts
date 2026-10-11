import type {
  Flowchart,
  FlowNode,
  SequenceDiagram,
  SequenceItem,
  SequenceMessage,
  StateMachine,
  StateMachineState,
  Swimlane,
} from "@exadev/process-graph-projection";
import type { IdSpace } from "@exadev/process-graph-schema";
import { transitionLabel } from "./mermaid.ts";
import { dotString } from "./text.ts";

const indent = "  ";

/** DOT attributes as name and value pairs, in the order written. */
type Attributes = readonly (readonly [string, string])[];

/** A DOT attribute list from name and value pairs, each value quoted; empty when there are none. */
const attributes = (pairs: Attributes): string =>
  pairs.length === 0
    ? ""
    : ` [${pairs.map(([name, value]) => `${name}=${dotString(value)}`).join(", ")}]`;

/** A flowchart node's DOT shape: an oval terminator, a box process, a diamond decision, and a filled bar for a fork or join. */
const nodeShapes: Readonly<Record<FlowNode<IdSpace>["shape"], Attributes>> = {
  terminator: [["shape", "oval"]],
  process: [["shape", "box"]],
  decision: [["shape", "diamond"]],
  bar: [
    ["shape", "box"],
    ["style", "filled"],
    ["fillcolor", "black"],
    ["fontcolor", "white"],
  ],
};

const dotNode = <I extends IdSpace>(node: FlowNode<I>, depth: string): string =>
  `${depth}${dotString(node.id)}${attributes([["label", node.label], ...nodeShapes[node.shape]])};`;

/** The edges of a flowchart, a hand-off (an edge whose ends are in different lanes) drawn bold. */
const dotEdges = <I extends IdSpace>(
  view: Flowchart<I>,
  isHandoff: (from: I["element"], to: I["element"]) => boolean,
): readonly string[] =>
  view.edges.map(
    (edge) =>
      `${indent}${dotString(edge.from)} -> ${dotString(edge.to)}${attributes([
        ...(edge.label === undefined ? [] : [["label", edge.label] as const]),
        ...(isHandoff(edge.from, edge.to) ? [["style", "bold"] as const] : []),
      ])};`,
  );

/**
 * A flowchart as a Graphviz `digraph`, top to bottom. Nodes are named by their model identifiers, so the DOT source reads back to the model directly.
 * @param view - The projected flowchart.
 * @returns DOT source, ending with a line break.
 */
export const flowchartToDot = <I extends IdSpace>(view: Flowchart<I>): string =>
  `${[
    `digraph ${dotString("flowchart")} {`,
    `${indent}rankdir="TB";`,
    ...view.nodes.map((node) => dotNode(node, indent)),
    ...dotEdges(view, () => false),
    "}",
  ].join("\n")}\n`;

/**
 * A swimlane as a Graphviz `digraph`, left to right, with one `cluster` subgraph per lane in the view's lane order and nodes with no actor outside every lane. An empty lane holds one invisible point so Graphviz still draws it. Hand-offs, the edges that change lane, are drawn bold.
 * @param view - The projected swimlane.
 * @returns DOT source, ending with a line break.
 */
export const swimlaneToDot = <I extends IdSpace>(view: Swimlane<I>): string => {
  const nodes = new Map(view.nodes.map((node) => [node.id, node]));
  const laneOf = new Map<I["element"], number>();
  view.lanes.forEach((lane, index) => {
    for (const id of lane.nodes) {
      laneOf.set(id, index);
    }
  });
  const declare = (id: I["element"], depth: string): string => {
    const node = nodes.get(id);
    if (node === undefined) {
      throw new Error(`lane member "${id}" is not a node of the view`);
    }

    return dotNode(node, depth);
  };

  return `${[
    `digraph ${dotString("swimlane")} {`,
    `${indent}rankdir="LR";`,
    ...view.lanes.flatMap((lane, index) => {
      const cluster = `cluster_lane${String(index)}`;

      return [
        `${indent}subgraph ${dotString(cluster)} {`,
        `${indent.repeat(2)}label=${dotString(lane.label)};`,
        ...(lane.nodes.length === 0
          ? [
              `${indent.repeat(2)}${dotString(`${cluster}:empty`)}${attributes([
                ["shape", "point"],
                ["style", "invis"],
              ])};`,
            ]
          : lane.nodes.map((id) => declare(id, indent.repeat(2)))),
        `${indent}}`,
      ];
    }),
    ...view.unassigned.map((id) => declare(id, indent)),
    ...dotEdges(view, (from, to) => {
      const fromLane = laneOf.get(from);
      const toLane = laneOf.get(to);

      return (
        fromLane !== undefined && toLane !== undefined && fromLane !== toLane
      );
    }),
    "}",
  ].join("\n")}\n`;
};

/** A state's DOT shape: a filled point for an initial pseudo-state, a double circle for a final one, a rounded box for a state. */
const stateShape = <I extends IdSpace>(
  state: StateMachineState<I>,
): Attributes => {
  if (state.role === "initial") {
    return [
      ["label", ""],
      ["shape", "point"],
    ];
  }
  if (state.role === "final") {
    return [
      ["label", ""],
      ["shape", "doublecircle"],
    ];
  }

  return [
    ["label", state.label],
    ["shape", "box"],
    ["style", "rounded"],
  ];
};

/**
 * A state machine as a Graphviz `digraph`, left to right. Each transition is labelled with its event, guard and effect.
 * @param view - The projected state machine.
 * @returns DOT source, ending with a line break.
 */
export const stateMachineToDot = <I extends IdSpace>(
  view: StateMachine<I>,
): string =>
  `${[
    `digraph ${dotString("state machine")} {`,
    `${indent}rankdir="LR";`,
    ...view.states.map(
      (state) =>
        `${indent}${dotString(state.id)}${attributes(stateShape(state))};`,
    ),
    ...view.transitions.map((transition) => {
      const label = transitionLabel(transition);

      return `${indent}${dotString(transition.source)} -> ${dotString(transition.target)}${attributes(label === "" ? [] : [["label", label]])};`;
    }),
    "}",
  ].join("\n")}\n`;

/** A message with the fragments around it, outermost first, each as its operator and the guard of the operand it is in. */
interface PlacedMessage<I extends IdSpace> {
  readonly message: SequenceMessage<I>;
  readonly fragments: readonly string[];
}

const placeMessages = <I extends IdSpace>(
  items: readonly SequenceItem<I>[],
  fragments: readonly string[],
): readonly PlacedMessage<I>[] =>
  items.flatMap((item) =>
    item.kind === "message"
      ? [{ message: item.message, fragments }]
      : item.operands.flatMap((operand) =>
          placeMessages(operand.items, [
            ...fragments,
            operand.guard === undefined
              ? item.operator
              : `${item.operator} [${operand.guard}]`,
          ]),
        ),
  );

/**
 * A sequence diagram as a Graphviz `digraph`. DOT has no sequence notation, so the diagram is drawn as a grid: a column per lifeline, headed by its participant's label, with one row per message in scenario order. Each message is an arrow across its row, numbered by its step and prefixed with the fragments around it (operator and guard, outermost first), since DOT cannot draw a box around arrows.
 * @param view - The projected sequence diagram.
 * @param participantLabel - The label of a lifeline's participant.
 * @returns DOT source, ending with a line break.
 */
export const sequenceToDot = <I extends IdSpace>(
  view: SequenceDiagram<I>,
  participantLabel: (participant: I["actor"]) => string,
): string => {
  const columns = new Map(
    view.lifelines.map((lifeline, index) => [lifeline, index]),
  );
  const column = (lifeline: I["actor"]): number => {
    const index = columns.get(lifeline);
    if (index === undefined) {
      throw new Error(`"${lifeline}" is not a lifeline of the view`);
    }

    return index;
  };
  const head = (index: number): string => dotString(`p${String(index)}`);
  const cell = (index: number, row: number): string =>
    dotString(`p${String(index)}.${String(row)}`);
  const placed = placeMessages(view.items, []);
  const rows = placed.map((_, row) => row + 1);
  const pointAttributes = attributes([
    ["shape", "point"],
    ["width", "0"],
  ]);

  return `${[
    `digraph ${dotString("sequence")} {`,
    `${indent}rankdir="TB";`,
    ...view.lifelines.map(
      (lifeline, index) =>
        `${indent}${head(index)}${attributes([
          ["label", participantLabel(lifeline)],
          ["shape", "box"],
        ])};`,
    ),
    `${indent}{ rank="same"; ${view.lifelines.map((_, index) => `${head(index)};`).join(" ")} }`,
    ...view.lifelines
      .slice(1)
      .map(
        (_, index) =>
          `${indent}${head(index)} -> ${head(index + 1)}${attributes([["style", "invis"]])};`,
      ),
    ...rows.flatMap((row) => [
      ...view.lifelines.map(
        (_, index) => `${indent}${cell(index, row)}${pointAttributes};`,
      ),
      `${indent}{ rank="same"; ${view.lifelines.map((_, index) => `${cell(index, row)};`).join(" ")} }`,
    ]),
    ...(rows.length === 0
      ? []
      : view.lifelines.map(
          (_, index) =>
            `${indent}${[head(index), ...rows.map((row) => cell(index, row))].join(" -> ")}${attributes(
              [
                ["style", "dashed"],
                ["arrowhead", "none"],
              ],
            )};`,
        )),
    ...placed.map(({ message, fragments }, index) => {
      const row = index + 1;
      const text =
        fragments.length === 0
          ? message.label
          : `${fragments.join(" / ")}: ${message.label}`;

      return `${indent}${cell(column(message.from), row)} -> ${cell(column(message.to), row)}${attributes(
        [
          ["label", `${String(row)}. ${text}`],
          ["constraint", "false"],
        ],
      )};`;
    }),
    "}",
  ].join("\n")}\n`;
};

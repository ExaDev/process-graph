import type {
  Flowchart,
  FlowNode,
  SequenceDiagram,
  SequenceItem,
  StateMachine,
  StateMachineTransition,
  Swimlane,
} from "@exadev/process-graph-projection";
import type { IdSpace } from "@exadev/process-graph-schema";
import { mermaidText } from "./text.ts";

/**
 * Model identifiers are free text (`github:org/repo#12`), which Mermaid does not accept as a node identifier, so every emitter names things by position in the view instead: a prefix and the index. The view's order is the model's order, so the same model always gives the same names.
 */
const positionalIds = <Id extends string>(
  prefix: string,
  ids: readonly Id[],
): ReadonlyMap<Id, string> =>
  new Map(ids.map((id, index) => [id, `${prefix}${String(index)}`]));

/** Reads a name the emitter itself assigned, which exists for every identifier the view lists. */
const nameIn = <Id extends string>(
  names: ReadonlyMap<Id, string>,
  id: Id,
): string => {
  const name = names.get(id);
  if (name === undefined) {
    throw new Error(`"${id}" is not part of the view being emitted`);
  }

  return name;
};

const indent = "  ";

/** Each flowchart shape in Mermaid's syntax around a node name and quoted label: a stadium for a terminator, a rectangle for a process, a rhombus for a decision and a fork bar for a fork or join. */
const mermaidShapes: Readonly<
  Record<FlowNode<IdSpace>["shape"], (name: string, label: string) => string>
> = {
  terminator: (name, label) => `${name}(["${label}"])`,
  process: (name, label) => `${name}["${label}"]`,
  decision: (name, label) => `${name}{"${label}"}`,
  bar: (name, label) => `${name}@{ shape: fork, label: "${label}" }`,
};

const mermaidNode = <I extends IdSpace>(
  name: string,
  node: FlowNode<I>,
): string => mermaidShapes[node.shape](name, mermaidText(node.label));

/** The edges of a flowchart, a hand-off (an edge whose ends are in different lanes) drawn thick. */
const mermaidEdges = <I extends IdSpace>(
  view: Flowchart<I>,
  names: ReadonlyMap<I["element"], string>,
  isHandoff: (from: I["element"], to: I["element"]) => boolean,
): readonly string[] =>
  view.edges.map((edge) => {
    const arrow = isHandoff(edge.from, edge.to) ? "==>" : "-->";
    const label =
      edge.label === undefined ? "" : `|"${mermaidText(edge.label)}"|`;

    return `${indent}${nameIn(names, edge.from)} ${arrow}${label} ${nameIn(names, edge.to)}`;
  });

/**
 * A flowchart as a Mermaid `flowchart`, top to bottom. Nodes are declared in the view's order, then edges, each with its guard as the edge label.
 * @param view - The projected flowchart.
 * @returns Mermaid source, ending with a line break.
 */
export const flowchartToMermaid = <I extends IdSpace>(
  view: Flowchart<I>,
): string => {
  const names = positionalIds(
    "n",
    view.nodes.map((node) => node.id),
  );

  return `${[
    "flowchart TD",
    ...view.nodes.map(
      (node) => `${indent}${mermaidNode(nameIn(names, node.id), node)}`,
    ),
    ...mermaidEdges(view, names, () => false),
  ].join("\n")}\n`;
};

/**
 * A swimlane as a Mermaid `flowchart`, left to right, with one subgraph per lane in the view's lane order (an empty lane is an empty subgraph, so it stays visible) and nodes with no actor outside every lane. Hand-offs, the edges that change lane, are drawn thick.
 * @param view - The projected swimlane.
 * @returns Mermaid source, ending with a line break.
 */
export const swimlaneToMermaid = <I extends IdSpace>(
  view: Swimlane<I>,
): string => {
  const names = positionalIds(
    "n",
    view.nodes.map((node) => node.id),
  );
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

    return `${depth}${mermaidNode(nameIn(names, id), node)}`;
  };

  return `${[
    "flowchart LR",
    ...view.lanes.flatMap((lane, index) => [
      `${indent}subgraph lane${String(index)}["${mermaidText(lane.label)}"]`,
      ...lane.nodes.map((id) => declare(id, indent.repeat(2))),
      `${indent}end`,
    ]),
    ...view.unassigned.map((id) => declare(id, indent)),
    ...mermaidEdges(view, names, (from, to) => {
      const fromLane = laneOf.get(from);
      const toLane = laneOf.get(to);

      return (
        fromLane !== undefined && toLane !== undefined && fromLane !== toLane
      );
    }),
  ].join("\n")}\n`;
};

/** A state machine transition's label: its event, its guard in brackets and its effect after a slash, each only when present. */
export const transitionLabel = <I extends IdSpace>(
  transition: StateMachineTransition<I>,
): string =>
  [
    transition.event,
    transition.guard === undefined ? undefined : `[${transition.guard}]`,
    transition.effect === undefined ? undefined : `/ ${transition.effect}`,
  ]
    .filter((part) => part !== undefined)
    .join(" ");

/**
 * A state machine as a Mermaid `stateDiagram-v2`. Initial and final pseudo-states are Mermaid's `[*]`; every other state is declared with its label. Each transition carries its event, guard and effect.
 * @param view - The projected state machine.
 * @returns Mermaid source, ending with a line break.
 */
export const stateMachineToMermaid = <I extends IdSpace>(
  view: StateMachine<I>,
): string => {
  const drawn = view.states.filter((state) => state.role === "state");
  const names = new Map<I["element"], string>([
    ...positionalIds(
      "s",
      drawn.map((state) => state.id),
    ),
    ...view.states
      .filter((state) => state.role !== "state")
      .map((state): [I["element"], string] => [state.id, "[*]"]),
  ]);

  return `${[
    "stateDiagram-v2",
    ...drawn.map(
      (state) =>
        `${indent}state "${mermaidText(state.label)}" as ${nameIn(names, state.id)}`,
    ),
    ...view.transitions.map((transition) => {
      const label = transitionLabel(transition);

      return `${indent}${nameIn(names, transition.source)} --> ${nameIn(names, transition.target)}${label === "" ? "" : ` : ${mermaidText(label)}`}`;
    }),
  ].join("\n")}\n`;
};

/** The Mermaid keyword that separates one operand of a fragment from the next, for the operators with more than one operand. */
const operandSeparator = (operator: string): string =>
  operator === "par" ? "and" : "else";

/**
 * A sequence diagram as a Mermaid `sequenceDiagram`. Lifelines are declared in order of first appearance, labelled through `participantLabel`; messages follow in scenario order, wrapped in the fragments the projection drew (`alt` operands separated by `else`, `par` operands by `and`), each operand headed by its guard.
 * @param view - The projected sequence diagram.
 * @param participantLabel - The label of a lifeline's participant.
 * @returns Mermaid source, ending with a line break.
 */
export const sequenceToMermaid = <I extends IdSpace>(
  view: SequenceDiagram<I>,
  participantLabel: (participant: I["actor"]) => string,
): string => {
  const names = positionalIds("p", view.lifelines);
  const items = (
    list: readonly SequenceItem<I>[],
    depth: number,
  ): readonly string[] =>
    list.flatMap((item) => {
      const prefix = indent.repeat(depth);
      if (item.kind === "message") {
        const { message } = item;

        return [
          `${prefix}${nameIn(names, message.from)}->>${nameIn(names, message.to)}: ${mermaidText(message.label)}`,
        ];
      }

      return [
        ...item.operands.flatMap((operand, index) => {
          const keyword =
            index === 0 ? item.operator : operandSeparator(item.operator);
          const guard =
            operand.guard === undefined ? "" : ` ${mermaidText(operand.guard)}`;

          return [
            `${prefix}${keyword}${guard}`,
            ...items(operand.items, depth + 1),
          ];
        }),
        `${prefix}end`,
      ];
    });

  return `${[
    "sequenceDiagram",
    ...view.lifelines.map(
      (lifeline) =>
        `${indent}participant ${nameIn(names, lifeline)} as ${mermaidText(participantLabel(lifeline))}`,
    ),
    ...items(view.items, 1),
  ].join("\n")}\n`;
};

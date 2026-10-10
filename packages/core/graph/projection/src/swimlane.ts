import type { IdSpace, Model } from "@exadev/process-graph-schema";
import { actorMap } from "./actors.ts";
import { flowchartLoss, toFlowchart, type Flowchart } from "./flowchart.ts";
import { handoffs, type Handoff } from "./handoffs.ts";

/** One lane. `participant` is a declared role or system; in a runtime model it may instead be an actor that was named but never declared, which `validate` reports. */
export interface Lane<I extends IdSpace> {
  readonly participant: I["participant"] | I["actor"];
  readonly label: string;
  readonly nodes: readonly I["element"][];
}

export interface Swimlane<I extends IdSpace> extends Flowchart<I> {
  readonly lanes: readonly Lane<I>[];
  /** Nodes with no actor, such as start and end terminators. */
  readonly unassigned: readonly I["element"][];
  readonly handoffs: readonly Handoff<I>[];
}

/**
 * A flowchart plus partitions: a lane for every declared role or system, in declaration order and empty when nothing is assigned to it, then a lane for each actor that was named but never declared. Hand-offs are the edges that change lane.
 */
export const toSwimlane = <I extends IdSpace>(model: Model<I>): Swimlane<I> => {
  const flow = toFlowchart(model);
  const actors = actorMap(model);

  const members = new Map<I["participant"] | I["actor"], I["element"][]>();
  const unassigned: I["element"][] = [];
  for (const node of flow.nodes) {
    const actor = actors.get(node.id);
    if (actor === undefined) {
      unassigned.push(node.id);
      continue;
    }
    const lane = members.get(actor);
    if (lane === undefined) {
      members.set(actor, [node.id]);
    } else {
      lane.push(node.id);
    }
  }

  const lanes: Lane<I>[] = [];
  const declared = new Set<I["participant"] | I["actor"]>();
  for (const participant of model.participants) {
    if (participant.kind === "entity") {
      continue;
    }
    declared.add(participant.id);
    lanes.push({
      participant: participant.id,
      label: participant.label,
      nodes: members.get(participant.id) ?? [],
    });
  }
  for (const [actor, nodes] of members) {
    if (!declared.has(actor)) {
      lanes.push({ participant: actor, label: actor, nodes });
    }
  }

  return {
    ...flow,
    lanes,
    unassigned,
    handoffs: handoffs(model),
    loss: flowchartLoss(model, "swimlane", flow.nodes),
  };
};

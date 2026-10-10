import type { IdSpace, Model } from "@exadev/process-graph-schema";
import { actorMap } from "./actors.ts";
import { toFlowchart, type Flowchart } from "./flowchart.ts";
import { handoffs, type Handoff } from "./handoffs.ts";

export interface Lane<I extends IdSpace> {
  readonly participant: I["actor"];
  readonly label: string;
  readonly nodes: readonly I["element"][];
}

export interface Swimlane<I extends IdSpace> extends Flowchart<I> {
  readonly lanes: readonly Lane<I>[];
  /** Nodes with no actor, such as start and end terminators. */
  readonly unassigned: readonly I["element"][];
  readonly handoffs: readonly Handoff<I>[];
}

/** A flowchart plus partitions: lanes from actors, hand-offs where an edge changes lane. */
export const toSwimlane = <I extends IdSpace>(model: Model<I>): Swimlane<I> => {
  const flow = toFlowchart(model);
  const actors = actorMap(model);

  const members = new Map<I["actor"], I["element"][]>();
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
  for (const [actor, nodes] of members) {
    const declared = model.participants.find(
      (participant) => participant.id === actor,
    );
    lanes.push({
      participant: actor,
      label: declared === undefined ? actor : declared.label,
      nodes,
    });
  }

  return { ...flow, lanes, unassigned, handoffs: handoffs(model) };
};

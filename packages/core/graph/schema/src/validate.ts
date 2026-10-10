import type { IdSpace } from "./ids.ts";
import type { Model } from "./model.ts";
import type { ParticipantKind } from "./vocabulary.ts";

export type IssueCode =
  | "duplicate-id"
  | "unknown-reference"
  | "multiple-initial"
  | "subject-not-entity"
  | "actor-is-entity";

export interface Issue {
  readonly code: IssueCode;
  readonly message: string;
}

const duplicates = (ids: readonly string[]): readonly string[] => {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) {
      repeated.add(id);
    }
    seen.add(id);
  }

  return [...repeated];
};

/**
 * Runtime validation. Authored models are already reference-safe at compile time. This is for models loaded from JSON, where identifiers are plain strings, and for the rules the type system cannot state: unique identifiers, one initial pseudo-state per scope, and entity subjects for state machine projections.
 */
export const validate = <I extends IdSpace>(
  model: Model<I>,
): readonly Issue[] => {
  const issues: Issue[] = [];

  const participantIds = new Set<string>(model.participants.map((p) => p.id));
  const eventIds = new Set<string>(model.events.map((e) => e.id));
  const actionIds = new Set<string>(model.actions.map((a) => a.id));
  const elementIds = new Set<string>(model.elements.map((e) => e.id));
  const transitionIds = new Set<string>(model.transitions.map((t) => t.id));

  const spaces: readonly (readonly [string, readonly string[]])[] = [
    ["participant", model.participants.map((p) => p.id)],
    ["event", model.events.map((e) => e.id)],
    ["action", model.actions.map((a) => a.id)],
    ["element", model.elements.map((e) => e.id)],
    ["transition", model.transitions.map((t) => t.id)],
    ["fragment", model.fragments.map((f) => f.id)],
  ];
  for (const [space, ids] of spaces) {
    for (const id of duplicates(ids)) {
      issues.push({
        code: "duplicate-id",
        message: `Duplicate ${space} id "${id}"`,
      });
    }
  }

  const require = (
    known: ReadonlySet<string>,
    id: string | undefined,
    where: string,
  ): void => {
    if (id !== undefined && !known.has(id)) {
      issues.push({
        code: "unknown-reference",
        message: `${where} refers to unknown id "${id}"`,
      });
    }
  };

  const kindOf = new Map<string, ParticipantKind>(
    model.participants.map((p) => [p.id, p.kind]),
  );

  /** An actor must be declared, and must not be an entity. */
  const requireActor = (id: string | undefined, where: string): void => {
    require(participantIds, id, where);
    if (id !== undefined && kindOf.get(id) === "entity") {
      issues.push({
        code: "actor-is-entity",
        message: `${where} refers to entity "${id}", which cannot act`,
      });
    }
  };

  for (const element of model.elements) {
    switch (element.kind) {
      case "activity":
        requireActor(element.actor, `activity "${element.id}" actor`);
        require(actionIds, element.action, `activity "${element.id}" action`);
        break;
      case "decision":
        requireActor(element.actor, `decision "${element.id}" actor`);
        break;
      case "state":
        require(elementIds, element.parent, `state "${element.id}" parent`);
        require(actionIds, element.entry, `state "${element.id}" entry`);
        require(actionIds, element.exit, `state "${element.id}" exit`);
        break;
      case "pseudo":
        require(elementIds, element.parent, `pseudo "${element.id}" parent`);
        break;
      case "message":
        requireActor(element.from, `message "${element.id}" from`);
        requireActor(element.to, `message "${element.id}" to`);
        require(eventIds, element.event, `message "${element.id}" event`);
        break;
    }
  }

  for (const transition of model.transitions) {
    const where = `transition "${transition.id}"`;
    require(elementIds, transition.source, `${where} source`);
    require(elementIds, transition.target, `${where} target`);
    require(eventIds, transition.trigger, `${where} trigger`);
    require(actionIds, transition.effect, `${where} effect`);
  }

  for (const fragment of model.fragments) {
    for (const operand of fragment.operands) {
      for (const id of operand.body) {
        require(elementIds, id, `fragment "${fragment.id}" body`);
      }
    }
  }

  const initialsByScope = new Map<string, number>();
  for (const element of model.elements) {
    if (element.kind === "pseudo" && element.role === "initial") {
      const scope = element.parent ?? "";
      initialsByScope.set(scope, (initialsByScope.get(scope) ?? 0) + 1);
    }
  }
  for (const [scope, count] of initialsByScope) {
    if (count > 1) {
      const label = scope === "" ? "the top level" : `"${scope}"`;
      issues.push({
        code: "multiple-initial",
        message: `${label} has ${count} initial pseudo-states`,
      });
    }
  }

  for (const projection of model.projections) {
    if (projection.notation === "stateMachine") {
      require(participantIds, projection.subject, `projection "${projection.id}" subject`);
      if (kindOf.get(projection.subject) !== "entity") {
        issues.push({
          code: "subject-not-entity",
          message: `projection "${projection.id}" subject "${projection.subject}" is not an entity`,
        });
      }
    }
    if (projection.notation === "sequence") {
      for (const id of projection.scenario) {
        require(transitionIds, id, `projection "${projection.id}" scenario`);
      }
    }
  }

  return issues;
};

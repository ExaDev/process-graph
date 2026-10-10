import type { IdSpace } from "./ids.ts";
import type {
  FragmentOperator,
  MessageMode,
  Notation,
  ParticipantKind,
  PseudoRole,
} from "./vocabulary.ts";

/* ---------------------------------------------------------------------------
   Declarations (D) and references (R)

   D supplies the identifier a thing declares. R supplies the identifiers it refers to. Keeping them apart lets defineModel infer identifiers from declarations only.
   --------------------------------------------------------------------------- */

export interface Participant<
  Id extends string,
  Kind extends ParticipantKind = ParticipantKind,
> {
  readonly id: Id;
  readonly label: string;
  readonly kind: Kind;
}

export type AnyParticipants = readonly Participant<string>[];

/** Identifiers of the declared participants whose kind is one of `Kind`. */
export type IdsOfKind<
  Ps extends AnyParticipants,
  Kind extends ParticipantKind,
> = Extract<Ps[number], { readonly kind: Kind }>["id"];

export interface EventDef<Id extends string> {
  readonly id: Id;
  readonly name: string;
  readonly payload?: Readonly<Record<string, string>>;
}

export interface ActionDef<Id extends string> {
  readonly id: Id;
  readonly name: string;
}

export type Element<Id extends string, R extends IdSpace> =
  | {
      readonly kind: "activity";
      readonly id: Id;
      readonly label: string;
      readonly actor?: R["actor"];
      readonly action?: R["action"];
    }
  | {
      readonly kind: "decision";
      readonly id: Id;
      readonly label: string;
      readonly actor?: R["actor"];
    }
  | {
      readonly kind: "state";
      readonly id: Id;
      readonly label: string;
      readonly parent?: R["element"];
      readonly entry?: R["action"];
      readonly exit?: R["action"];
    }
  | {
      readonly kind: "pseudo";
      readonly id: Id;
      readonly role: PseudoRole;
      readonly parent?: R["element"];
    }
  | {
      readonly kind: "message";
      readonly id: Id;
      readonly label: string;
      readonly from: R["actor"];
      readonly to: R["actor"];
      readonly mode: MessageMode;
      readonly event?: R["event"];
    };

export interface Transition<Id extends string, R extends IdSpace> {
  readonly id: Id;
  readonly source: R["element"];
  readonly target: R["element"];
  readonly trigger?: R["event"];
  readonly guard?: string;
  readonly effect?: R["action"];
}

export interface FragmentOperand<R extends IdSpace> {
  readonly guard?: string;
  readonly body: readonly R["element"][];
}

export interface Fragment<Id extends string, R extends IdSpace> {
  readonly id: Id;
  readonly operator: FragmentOperator;
  readonly operands: readonly FragmentOperand<R>[];
}

/**
 * A projection records the extra input a lossy direction needs. Flowchart and swimlane need none. A state machine needs its subject entity. A sequence diagram needs the scenario it follows.
 */
export type Projection<R extends IdSpace> =
  | { readonly id: string; readonly notation: "flowchart" | "swimlane" }
  | {
      readonly id: string;
      readonly notation: "stateMachine";
      readonly subject: R["entity"];
    }
  | {
      readonly id: string;
      readonly notation: "sequence";
      readonly scenario: readonly R["transition"][];
    };

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Layout lives apart from the semantic model, keyed by element identifier. */
export type Views<ElementId extends string> = Readonly<
  Partial<Record<Notation, Readonly<Partial<Record<ElementId, Point>>>>>
>;

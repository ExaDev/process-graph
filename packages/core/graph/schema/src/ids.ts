export interface IdSpace {
  /** Every declared participant. */
  readonly participant: string;
  /** Participants of kind "role" or "system": the ones that can act. */
  readonly actor: string;
  /** Participants of kind "entity": the ones whose lifecycle a state machine can track. */
  readonly entity: string;
  readonly event: string;
  readonly action: string;
  readonly element: string;
  readonly transition: string;
  readonly fragment: string;
  /** The data or deliverables activities consume and produce. */
  readonly artefact: string;
}

/** The open identifier space, used for models whose identifiers are only known at runtime. */
export type OpenIds = IdSpace;

import { toSequence } from "@exadev/process-graph-projection";
import type { Run } from "@exadev/process-graph-react";
import type { IdSpace, Projection } from "@exadev/process-graph-schema";
import { SequenceDiagram } from "@exadev/process-graph-ui";
import { useMemo, type ReactElement } from "react";
import { ProcessFlow, type ProcessFlowProps } from "./process-flow.tsx";

type SequenceProjection<I extends IdSpace> = Extract<
  Projection<I>,
  { readonly notation: "sequence" }
>;

interface SequenceViewProps<I extends IdSpace> {
  readonly run: Run<I>;
  readonly projection: SequenceProjection<I>;
  readonly label: string;
}

const SequenceView = <I extends IdSpace>(
  props: SequenceViewProps<I>,
): ReactElement => {
  const { run, projection, label } = props;
  const diagram = useMemo(
    () => toSequence(run.model, projection.scenario),
    [run.model, projection],
  );
  const participants = useMemo(
    () =>
      new Map<string, string>(
        run.model.participants.map((participant) => [
          participant.id,
          participant.label,
        ]),
      ),
    [run.model],
  );

  return (
    <SequenceDiagram
      diagram={diagram}
      title={label}
      // An actor a runtime model names without declaring it has no label, so it is shown by its id, as the swimlane names its lane.
      labelOf={(actor) => participants.get(actor) ?? actor}
    />
  );
};

export interface ProcessViewProps<I extends IdSpace> extends Omit<
  ProcessFlowProps<I>,
  "projection"
> {
  /** Any of the model's projections. */
  readonly projection: Projection<I>;
}

/**
 * Any projection of a model: a sequence projection as graph-ui's SVG sequence diagram, since React Flow has no lifeline layout, and every other as a `ProcessFlow` canvas.
 * @param props - As for `ProcessFlow`, with any projection. A sequence diagram uses only the run's model and the label, as its caption.
 * @returns The view.
 */
export const ProcessView = <I extends IdSpace>(
  props: ProcessViewProps<I>,
): ReactElement => {
  const { projection, run, label } = props;

  return projection.notation === "sequence" ? (
    <SequenceView run={run} projection={projection} label={label} />
  ) : (
    <ProcessFlow {...props} projection={projection} />
  );
};

import { factNamesIn, type FactRecord } from "@exadev/process-graph-domain";
import type { Element, Model, OpenIds } from "@exadev/process-graph-schema";
import { useId, useState, type ReactElement } from "react";
import { button, muted, row, section, sectionHeading } from "./app.css.ts";
import { failureOf } from "./failure.ts";

/** What can be recorded about an artefact, as the command line's `set artefact` takes it: `unknown` forgets it. */
export type ArtefactState = "provided" | "absent" | "unknown";

/** What can be recorded about a named fact from here, as the command line's `set fact` takes it: `unknown` forgets it. */
export type FactState = "true" | "false" | "unknown";

const artefactChoices: readonly {
  readonly state: ArtefactState;
  readonly label: string;
}[] = [
  { state: "provided", label: "Provided" },
  { state: "absent", label: "Absent" },
  { state: "unknown", label: "Unknown" },
];

const factChoices: readonly {
  readonly state: FactState;
  readonly label: string;
}[] = [
  { state: "true", label: "True" },
  { state: "false", label: "False" },
  { state: "unknown", label: "Unknown" },
];

/** The artefacts an element consumes and produces, consumed first, each once, in the order the element names them. */
const artefactsOf = (element: Element<string, OpenIds>): readonly string[] =>
  element.kind === "activity"
    ? [...new Set([...(element.consumes ?? []), ...(element.produces ?? [])])]
    : [];

/** The named facts the conditions of the transitions into and out of an element read, each once. */
const factsOf = (model: Model<OpenIds>, id: string): readonly string[] => [
  ...new Set(
    model.transitions.flatMap((transition) =>
      (transition.source === id || transition.target === id) &&
      transition.condition !== undefined
        ? factNamesIn(transition.condition)
        : [],
    ),
  ),
];

/** The recorded state of an artefact. */
const artefactStateOf = (facts: FactRecord, id: string): ArtefactState => {
  const provided = Object.hasOwn(facts.artefacts, id)
    ? facts.artefacts[id]
    : undefined;

  return provided === undefined ? "unknown" : provided ? "provided" : "absent";
};

/** The recorded state of a named fact, and its value as text when it is not a boolean, which the buttons cannot show. */
const factStateOf = (
  facts: FactRecord,
  name: string,
): { readonly state: FactState | undefined; readonly text?: string } => {
  const value = Object.hasOwn(facts.values, name)
    ? facts.values[name]
    : undefined;
  if (value === undefined) {
    return { state: "unknown" };
  }
  if (value.kind === "boolean") {
    return { state: value.value ? "true" : "false" };
  }

  return {
    state: undefined,
    text: value.kind === "text" ? value.value : JSON.stringify(value),
  };
};

export interface RunFactsProps {
  readonly model: Model<OpenIds>;
  readonly element: Element<string, OpenIds>;
  /** The model's fact record as the store holds it. */
  readonly facts: FactRecord;
  /** Records an artefact's state in the store, as the command line's `set artefact` does. */
  readonly onSetArtefact: (id: string, state: ArtefactState) => Promise<void>;
  /** Records a named fact's value in the store, as the command line's `set fact` does. */
  readonly onSetFact: (name: string, state: FactState) => Promise<void>;
}

/**
 * What is known from outside the process that decides the selected element: each artefact it consumes or produces, with controls to record it provided, absent or unknown, and each named fact the conditions around it read, with controls to record it true, false or unknown. Each part is left out when the element has nothing in it.
 * @param props - The model, the element, the stored facts and the actions.
 * @returns The sections, or nothing when the element has neither.
 */
export const RunFacts = (props: RunFactsProps): ReactElement | null => {
  const { model, element, facts, onSetArtefact, onSetFact } = props;
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const artefactsHeading = useId();
  const factsHeading = useId();
  const artefacts = artefactsOf(element);
  const names = factsOf(model, element.id);
  // The store validates every model it holds, so each artefact an element names is declared.
  const artefactName = (id: string): string => {
    const declared = model.artefacts.find((artefact) => artefact.id === id);
    if (declared === undefined) {
      throw new Error(`unreachable: artefact "${id}" is not declared`);
    }

    return declared.name;
  };
  if (artefacts.length === 0 && names.length === 0) {
    return null;
  }
  const run = (change: Readonly<Promise<void>>): void => {
    setProblem(undefined);
    change.catch((error: unknown) => {
      setProblem(failureOf(error).message);
    });
  };

  return (
    <>
      {artefacts.length === 0 ? null : (
        <section aria-labelledby={artefactsHeading} className={section}>
          <h3 id={artefactsHeading} className={sectionHeading}>
            Artefacts
          </h3>
          {artefacts.map((id) => {
            const current = artefactStateOf(facts, id);

            return (
              <div
                key={id}
                role="group"
                aria-label={artefactName(id)}
                className={row}
                data-artefact={id}
              >
                <span>{artefactName(id)}</span>
                {artefactChoices.map(({ state, label }) => (
                  <button
                    key={state}
                    type="button"
                    className={button}
                    aria-pressed={current === state}
                    onClick={() => {
                      run(onSetArtefact(id, state));
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            );
          })}
        </section>
      )}
      {names.length === 0 ? null : (
        <section aria-labelledby={factsHeading} className={section}>
          <h3 id={factsHeading} className={sectionHeading}>
            Facts
          </h3>
          {names.map((name) => {
            const current = factStateOf(facts, name);

            return (
              <div
                key={name}
                role="group"
                aria-label={name}
                className={row}
                data-fact={name}
              >
                <span>{name}</span>
                {current.text === undefined ? null : (
                  <span className={muted}>now {current.text}</span>
                )}
                {factChoices.map(({ state, label }) => (
                  <button
                    key={state}
                    type="button"
                    className={button}
                    aria-pressed={current.state === state}
                    onClick={() => {
                      run(onSetFact(name, state));
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            );
          })}
        </section>
      )}
      {problem === undefined ? null : (
        <p role="alert" className={muted}>
          The facts were not changed: {problem}
        </p>
      )}
    </>
  );
};

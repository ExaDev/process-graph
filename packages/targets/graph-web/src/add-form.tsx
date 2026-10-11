import type { ParticipantKind } from "@exadev/process-graph-schema";
import { useId, useState, type SubmitEvent, type ReactElement } from "react";
import {
  field,
  input,
  muted,
  primaryButton,
  row,
  section,
  sectionHeading,
} from "./app.css.ts";
import {
  additionKinds,
  additionOf,
  participantKinds,
  type Addition,
  type AdditionFields,
  type AdditionKind,
} from "./addition.ts";
import { failureOf } from "./failure.ts";

export interface AddFormProps {
  /** Adds the record to the model; rejects with the store's reason when the result would be invalid. */
  readonly onAdd: (addition: Addition) => Promise<void>;
}

const blank: AdditionFields = {
  id: "",
  label: "",
  participantKind: "role",
  actor: "",
  parent: "",
  deliverable: false,
  source: "",
  target: "",
  guard: "",
  trigger: "",
};

/** A text field of the add form. */
interface TextField {
  readonly name: Exclude<
    keyof AdditionFields,
    "participantKind" | "deliverable"
  >;
  readonly label: string;
  readonly required: boolean;
}

const needed = (name: TextField["name"], label: string): TextField => ({
  name,
  label,
  required: true,
});
const optional = (name: TextField["name"], label: string): TextField => ({
  name,
  label: `${label} (optional)`,
  required: false,
});

/** The text fields each kind asks for, mirroring the command line's `add` arguments (required) and options (optional). */
const textFields: Readonly<Record<AdditionKind, readonly TextField[]>> = {
  participant: [needed("id", "Identifier"), needed("label", "Label")],
  activity: [
    needed("id", "Identifier"),
    needed("label", "Label"),
    optional("actor", "Actor"),
  ],
  decision: [
    needed("id", "Identifier"),
    needed("label", "Label"),
    optional("actor", "Actor"),
  ],
  state: [
    needed("id", "Identifier"),
    needed("label", "Label"),
    optional("parent", "Parent state"),
  ],
  event: [needed("id", "Identifier"), needed("label", "Name")],
  artefact: [needed("id", "Identifier"), needed("label", "Name")],
  transition: [
    needed("source", "From"),
    needed("target", "To, which waits on the first"),
    optional("id", "Identifier"),
    optional("guard", "Guard"),
    optional("trigger", "Trigger event"),
  ],
};

const isKind = (value: string): value is AdditionKind =>
  additionKinds.some((kind) => kind === value);

const isParticipantKind = (value: string): value is ParticipantKind =>
  participantKinds.some((kind) => kind === value);

/**
 * Adds a participant, activity, decision, state, event, artefact or transition to the model by hand, as the command line's `add` does. The store checks the whole model on save, so a duplicate identifier or a dangling reference is refused and shown, and nothing changes.
 * @param props - What adding does.
 * @returns The form.
 */
export const AddForm = (props: AddFormProps): ReactElement => {
  const { onAdd } = props;
  const [kind, setKind] = useState<AdditionKind>("activity");
  const [fields, setFields] = useState<AdditionFields>(blank);
  const [outcome, setOutcome] = useState<string | undefined>(undefined);
  const headingId = useId();
  const prefix = useId();

  const submit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const addition = additionOf(kind, fields);
    onAdd(addition).then(
      () => {
        setOutcome(`Added ${addition.record.id}.`);
        setFields(blank);
      },
      (error: unknown) => {
        setOutcome(`Not added: ${failureOf(error).message}`);
      },
    );
  };

  return (
    <section aria-labelledby={headingId} className={section} data-screen="add">
      <h2 id={headingId} className={sectionHeading}>
        Add to the model
      </h2>
      <form className={field} onSubmit={submit}>
        <label className={field}>
          What to add
          <select
            className={input}
            value={kind}
            onChange={(event) => {
              if (isKind(event.target.value)) {
                setKind(event.target.value);
              }
            }}
          >
            {additionKinds.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {kind === "participant" ? (
          <label className={field}>
            Kind
            <select
              className={input}
              value={fields.participantKind}
              onChange={(event) => {
                const { value } = event.target;
                if (isParticipantKind(value)) {
                  setFields({ ...fields, participantKind: value });
                }
              }}
            >
              {participantKinds.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {textFields[kind].map(({ name, label, required }) => (
          <label key={name} className={field} htmlFor={`${prefix}-${name}`}>
            {label}
            <input
              id={`${prefix}-${name}`}
              className={input}
              spellCheck={false}
              required={required}
              value={fields[name]}
              onChange={(event) => {
                setFields({ ...fields, [name]: event.target.value });
              }}
            />
          </label>
        ))}
        {kind === "artefact" ? (
          <label className={row}>
            <input
              type="checkbox"
              checked={fields.deliverable}
              onChange={(event) => {
                setFields({ ...fields, deliverable: event.target.checked });
              }}
            />
            A deliverable: an output of the process
          </label>
        ) : null}
        <div className={row}>
          <button type="submit" className={primaryButton}>
            Add {kind}
          </button>
        </div>
      </form>
      {outcome === undefined ? null : (
        <p role="status" className={muted}>
          {outcome}
        </p>
      )}
    </section>
  );
};

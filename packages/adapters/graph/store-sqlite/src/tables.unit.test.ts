import { modelSchema, overlaySchema } from "@exadev/process-graph-schema";
import { createSelectSchema } from "drizzle-orm/zod";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import {
  actions,
  artefacts,
  elements,
  events,
  fragments,
  overlay,
  participants,
  projections,
  transitions,
} from "./tables.ts";

/**
 * Strips what storage and the model express differently for the same field: a nullable column against an optional or exact-optional field, and the model's readonly wrappers. What is left is the value's own type, which must agree.
 */
const valueOf = (schema: z.core.$ZodType): z.core.$ZodType => {
  if (
    schema instanceof z.ZodNullable ||
    schema instanceof z.ZodOptional ||
    schema instanceof z.ZodExactOptional ||
    schema instanceof z.ZodReadonly
  ) {
    return valueOf(schema.unwrap());
  }

  return schema;
};

/** The JSON Schema of a field's value, the comparable description of what it accepts. */
const described = (schema: z.core.$ZodType): unknown =>
  z.toJSONSchema(valueOf(schema));

const model = modelSchema.unwrap().shape;

/** One field of an object schema's shape, or `undefined` when it has none of that name. */
const fieldOf = (
  shape: Readonly<Record<string, z.core.$ZodType>>,
  field: string,
): z.core.$ZodType | undefined => shape[field];
const recordShape = <S extends z.ZodType>(list: z.ZodReadonly<z.ZodArray<S>>) =>
  list.unwrap().element;

const variants = model.elements
  .unwrap()
  .element.options.map((option) => option.unwrap().shape);

/** The shape of one element variant, by its kind. */
const variant = (kind: string): (typeof variants)[number] => {
  const shape = variants.find((candidate) => candidate.kind.value === kind);
  if (shape === undefined) {
    throw new Error(`No element variant "${kind}"`);
  }

  return shape;
};

/**
 * Each table against the model record it stores: every scalar column whose field the record also has. JSON columns (lists, payloads, extensions, conditions, operands, scenarios, views) are left out here because Drizzle derives an untyped JSON schema for them; `fromRows` parses them with the model schema on every read instead.
 */
const pairs = [
  {
    name: "participants",
    row: createSelectSchema(participants).shape,
    record: recordShape(model.participants).unwrap().shape,
    fields: ["id", "label", "kind"],
  },
  {
    name: "events",
    row: createSelectSchema(events).shape,
    record: recordShape(model.events).unwrap().shape,
    fields: ["id", "name"],
  },
  {
    name: "actions",
    row: createSelectSchema(actions).shape,
    record: recordShape(model.actions).unwrap().shape,
    fields: ["id", "name"],
  },
  {
    name: "artefacts",
    row: createSelectSchema(artefacts).shape,
    record: recordShape(model.artefacts).unwrap().shape,
    fields: ["id", "name", "deliverable"],
  },
  {
    name: "activity elements",
    row: createSelectSchema(elements).shape,
    record: variant("activity"),
    fields: ["id", "label", "actor", "action", "source"],
  },
  {
    name: "decision elements",
    row: createSelectSchema(elements).shape,
    record: variant("decision"),
    fields: ["id", "label", "actor"],
  },
  {
    name: "state elements",
    row: createSelectSchema(elements).shape,
    record: variant("state"),
    fields: ["id", "label", "parent", "entry", "exit"],
  },
  {
    name: "pseudo elements",
    row: createSelectSchema(elements).shape,
    record: variant("pseudo"),
    fields: ["id", "role", "parent"],
  },
  {
    name: "message elements",
    row: createSelectSchema(elements).shape,
    record: variant("message"),
    fields: ["id", "label", "from", "to", "mode", "event"],
  },
  {
    name: "transitions",
    row: createSelectSchema(transitions).shape,
    record: recordShape(model.transitions).unwrap().shape,
    fields: ["id", "source", "target", "trigger", "guard", "effect"],
  },
  {
    name: "fragments",
    row: createSelectSchema(fragments).shape,
    record: recordShape(model.fragments).unwrap().shape,
    fields: ["id", "operator"],
  },
] as const;

describe("the row schemas Drizzle derives and the model schema", () => {
  test.each(pairs)(
    "agree on the shared fields of $name",
    ({ row, record, fields }) => {
      for (const field of fields) {
        const rowField = fieldOf(row, field);
        const recordField = fieldOf(record, field);

        expect({ field, row: rowField && described(rowField) }).toEqual({
          field,
          row: recordField && described(recordField),
        });
      }
    },
  );

  test("the element kind column holds exactly the element variants' kinds", () => {
    expect(described(createSelectSchema(elements).shape.kind)).toEqual(
      z.toJSONSchema(z.enum(variants.map((shape) => shape.kind.value))),
    );
  });

  test("the projection notation column holds exactly the projection variants' notations", () => {
    const notations = model.projections
      .unwrap()
      .element.options.flatMap((option) => {
        const { notation } = option.unwrap().shape;

        return notation instanceof z.ZodEnum
          ? notation.options
          : [notation.value];
      });

    expect(described(createSelectSchema(projections).shape.notation)).toEqual(
      z.toJSONSchema(z.enum(notations)),
    );
  });

  test("the overlay status column holds exactly the overlay's statuses", () => {
    expect(described(createSelectSchema(overlay).shape.status)).toEqual(
      z.toJSONSchema(overlaySchema.unwrap().valueType),
    );
  });
});

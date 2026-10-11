import type { Element } from "@exadev/process-graph-schema";
import type { OrderIds } from "./ids.ts";
import { order } from "./order.ts";

/**
 * An element of the order fixture by id.
 * @param id - The element's id.
 * @returns The element.
 */
export const elementOf = (
  id: OrderIds["element"],
): Element<OrderIds["element"], OrderIds> => {
  const element = order.elements.find((candidate) => candidate.id === id);
  if (element === undefined) {
    throw new Error(`no element ${id}`);
  }

  return element;
};

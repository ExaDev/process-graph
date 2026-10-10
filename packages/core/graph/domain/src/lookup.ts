import { UnknownNodeError, type NodeId } from "@exadev/process-graph-dag";

/**
 * Reads a value out of a map built over every element of a model.
 * @throws UnknownNodeError when the key is absent, which for such a map means the model refers to an element it does not declare.
 */
export const lookup = <Id extends NodeId, Value>(
  map: ReadonlyMap<Id, Value>,
  id: Id,
): Value => {
  const value = map.get(id);
  if (value === undefined) {
    throw new UnknownNodeError(id);
  }

  return value;
};

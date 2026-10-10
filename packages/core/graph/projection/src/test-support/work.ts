/**
 * Counts the work a call does through the collection operations every projection is built from: each `push`, `Set.add` and `Map.set` counts one, and each array scan (`filter`, `map`, `flatMap`, `some`, `every`, `find`, `findIndex`, `includes`, `indexOf`) counts the length of the array it scans, so a scan of a whole list per item shows as quadratic. The operations are wrapped only while `run` runs and restored afterwards, even when it throws.
 * @param run - The call to measure.
 * @returns The work counted.
 */
export const workOf = (run: () => unknown): number => {
  let work = 0;
  const restores: (() => void)[] = [];
  const wrap = (
    target: object,
    name: string,
    cost: (self: unknown) => number,
  ): void => {
    const original: unknown = Reflect.get(target, name);
    if (typeof original !== "function") {
      throw new TypeError(`${name} is not a method`);
    }
    Reflect.defineProperty(target, name, {
      configurable: true,
      writable: true,
      value: function counted(
        this: unknown,
        ...args: readonly unknown[]
      ): unknown {
        work += cost(this);

        return Reflect.apply(original, this, args);
      },
    });
    restores.push(() => {
      Reflect.defineProperty(target, name, {
        configurable: true,
        writable: true,
        value: original,
      });
    });
  };
  const one = (): number => 1;
  const length = (self: unknown): number =>
    Array.isArray(self) ? self.length : 1;
  for (const name of [
    "filter",
    "map",
    "flatMap",
    "some",
    "every",
    "find",
    "findIndex",
    "includes",
    "indexOf",
  ]) {
    wrap(Array.prototype, name, length);
  }
  wrap(Array.prototype, "push", one);
  wrap(Set.prototype, "add", one);
  wrap(Map.prototype, "set", one);
  try {
    run();
  } finally {
    for (const restore of restores.toReversed()) {
      restore();
    }
  }

  return work;
};

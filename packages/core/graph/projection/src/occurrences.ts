/**
 * Items grouped by key, each group kept in its original order and read off one at a time: the projected messages of a sequence diagram grouped by transition, matched against an edited diagram occurrence by occurrence, since a loop repeats a step.
 *
 * Storing an item appends it to its group and reading one advances a position in that group, so building and draining the groups touches each item a constant number of times however often a key repeats.
 */
export class Occurrences<Key, Item> {
  readonly #groups = new Map<Key, { readonly items: Item[]; read: number }>();

  /**
   * @param items - The items, in order.
   * @param keyOf - The key an item is grouped by.
   * @param observe - Told of each item as it is stored, so a caller can measure the work done.
   */
  constructor(
    items: Readonly<Iterable<Item>>,
    keyOf: (item: Item) => Key,
    observe?: (item: Item) => void,
  ) {
    for (const item of items) {
      observe?.(item);
      const key = keyOf(item);
      const group = this.#groups.get(key);
      if (group === undefined) {
        this.#groups.set(key, { items: [item], read: 0 });
      } else {
        group.items.push(item);
      }
    }
  }

  /**
   * The next unread item of a key's group, which is then read.
   * @param key - The group to read from.
   * @returns The item, or `undefined` when the key has no group or every item in it has been read.
   */
  next(key: Key): Item | undefined {
    const group = this.#groups.get(key);
    const item = group?.items[group.read];
    if (group !== undefined && item !== undefined) {
      group.read += 1;
    }

    return item;
  }

  /**
   * The keys with items still unread, in the order their groups were first stored.
   * @returns The keys.
   */
  unread(): Key[] {
    return [...this.#groups]
      .filter(([, group]) => group.read < group.items.length)
      .map(([key]) => key);
  }
}

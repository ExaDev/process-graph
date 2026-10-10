/**
 * Pages through a cursor-linked sequence on demand: each `next()` reads one page, starting after `first`, and the sequence ends after the page whose `next` is absent. Nothing is read ahead of the consumer, so a consumer that stops early stops the reads.
 * @param first - The cursor to start after, or `undefined` for the first page.
 * @param read - Reads the page after a cursor.
 * @returns The pages, in order.
 */
export const paginate = <Page extends { readonly next?: string }>(
  first: string | undefined,
  read: (after: string | undefined) => Promise<Page>,
): AsyncIterable<Page> => ({
  [Symbol.asyncIterator]: () => {
    let after = first;
    let finished = false;

    return {
      // Consumers pull one page at a time, as `for await` does, so each read starts from the cursor the previous page left.
      next: async (): Promise<IteratorResult<Page, undefined>> => {
        if (finished) {
          return { done: true, value: undefined };
        }

        return read(after).then((page) => {
          after = page.next;
          finished = after === undefined;

          return { done: false, value: page };
        });
      },
    };
  },
});

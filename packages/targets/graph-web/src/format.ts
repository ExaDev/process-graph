/**
 * An instant as the person's locale writes a date and time, such as when a rate limit resets.
 * @param iso - An ISO 8601 instant.
 * @returns The instant in the browser's locale and time zone.
 */
export const formatInstant = (iso: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "long",
  }).format(new Date(iso));

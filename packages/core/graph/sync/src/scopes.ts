/** The separator between a scope's source prefix and the rest, as in `github:owner/repo`. */
const sourceSeparator = ":";

/** The scopes of one source, in the order they were given. */
export interface SourceScopes {
  /** The source's identifier prefix, such as `github`. */
  readonly prefix: string;
  readonly scopes: readonly string[];
}

/** Thrown for a scope that names no source: it has no prefix before a colon. */
export class InvalidScopeError extends Error {
  /** The scope as it was given. */
  readonly scope: string;

  /**
   * @param scope - The scope that names no source.
   */
  constructor(scope: string) {
    super(
      `"${scope}" is not a scope: write <source>:<scope>, such as github:owner/repo`,
    );
    this.name = "InvalidScopeError";
    this.scope = scope;
  }
}

/**
 * Groups source-qualified scopes by their source prefix, keeping each prefix where it first appears and each source's scopes in the order given. A sync reads the groups in this order, one source after another.
 * @param scopes - Source-qualified scopes, such as `github:owner` or `github:owner/repo`.
 * @returns One group per source prefix.
 * @throws InvalidScopeError for a scope with nothing before its first colon, or no colon at all.
 */
export const scopesBySource = (
  scopes: readonly string[],
): readonly SourceScopes[] => {
  const groups = new Map<string, string[]>();
  for (const scope of scopes) {
    const separator = scope.indexOf(sourceSeparator);
    if (separator <= 0) {
      throw new InvalidScopeError(scope);
    }
    const prefix = scope.slice(0, separator);
    groups.set(prefix, [...(groups.get(prefix) ?? []), scope]);
  }

  return [...groups].map(([prefix, grouped]) => ({ prefix, scopes: grouped }));
};

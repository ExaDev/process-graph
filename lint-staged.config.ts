/**
 * A plain `eslint --fix` over the staged file list, not a workspace-wide lint: ESLint's own flat config resolves the nearest `eslint.config.ts` per file automatically, so one invocation across files from several packages still applies each package's own rules. Never a workspace-wide fixer run against every file in every package. That would also rewrite unstaged hunks in a partially staged tree.
 *
 * Any staged `package.json` runs `syncpack fix` (workspace-wide, not staged-file-scoped, since a version fix in one manifest can only be judged correct relative to every other manifest) then `syncpack lint` as a safety net: `fix` mechanically rewrites what it can (a wrong range operator, a cross-package mismatch resolved to the highest semver present), and lint fails the commit on anything `fix` couldn't resolve on its own. lint-staged re-stages whatever `fix` rewrote, the same way `eslint --fix`'s own changes get re-staged above.
 */
import type { Configuration } from "lint-staged";

export default {
  "*.{ts,tsx,js,mjs,cjs,json,jsonc,md,yml,yaml}": "eslint --fix --cache",
  "package.json": () => ["syncpack fix", "syncpack lint"],
} satisfies Configuration;

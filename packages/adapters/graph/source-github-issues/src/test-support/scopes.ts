/**
 * The scopes the recorded fixtures cover, shared by the recorder and the tests that replay it. All are public: GitHub's own demo organisation, read as an owner scope, and two repositories whose issues block each other across repositories and across organisations.
 */
export const fixtureScope: readonly string[] = [
  "github:octo-org",
  "github:ExaDev/document-schema.js",
  "github:Mearman/agent-permissions",
];

/** A public Projects v2 board in GitHub's own organisation, holding issues, pull requests and draft issues, so passing over what is not an issue is exercised. */
export const fixtureProjectScope = "github:github/projects/16737";

/** An owner whose repositories span more than one listing page at the fixture page size. */
export const fixtureListingParent = "github:octo-org";

/** A repository synced under a filter that narrows by state and label and orders newest first. */
export const fixtureFilteredScope = "github:Mearman/agent-permissions";

/** The filter `fixtureFilteredScope` is synced under. */
export const fixtureFilter = {
  states: ["done"],
  labels: ["bug"],
  order: { field: "created", direction: "descending" },
} as const;

/** An owner that cannot exist: GitHub logins cannot contain a dot. */
export const missingOwnerScope = "github:not.a.login";

/** A repository of that owner, so it cannot exist either. */
export const missingRepositoryScope = "github:not.a.login/repository";

/** A small page size, so the fixture scopes span many pages and every connection overflows into its own requests somewhere. */
export const fixturePageSize = 3;

/** A public repository read only with a made-up token, so the fixture holds GitHub's answer to bad credentials. */
export const unauthorisedScope = "github:octocat/Hello-World";

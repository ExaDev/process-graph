import { z } from "zod";

// The GraphQL documents this adapter sends and the Zod schemas their `data` is parsed with. Each document asks for exactly the fields its schema reads, so a response GitHub changes incompatibly fails loudly at the parse.

const pageInfoSchema = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().nullable(),
});

const accountSchema = z.object({
  __typename: z.enum(["Organization", "User"]),
  login: z.string(),
});

const repositoryRefSchema = z.object({
  name: z.string(),
  owner: accountSchema,
});

/** An issue reached from another one: a blocker or a sub-issue, possibly in another repository or organisation. */
const issueRefSchema = z.object({
  number: z.int(),
  title: z.string(),
  state: z.enum(["OPEN", "CLOSED"]),
  repository: repositoryRefSchema,
});

const connectionOf = <Node extends z.ZodType>(node: Node) =>
  z.object({
    pageInfo: pageInfoSchema,
    // GitHub returns null for a node the token cannot see, alongside an error naming it.
    nodes: z.array(node.nullable()),
  });

const userSchema = z.object({ login: z.string() });

const issueSchema = issueRefSchema.extend({
  assignees: connectionOf(userSchema),
  blockedBy: connectionOf(issueRefSchema),
  subIssues: connectionOf(issueRefSchema),
});

export type PageInfo = z.infer<typeof pageInfoSchema>;
export type Account = z.infer<typeof accountSchema>;
export type IssueRef = z.infer<typeof issueRefSchema>;
export type Issue = z.infer<typeof issueSchema>;
export type User = z.infer<typeof userSchema>;

const accountFields = "__typename login";
const issueRefFields = `number title state repository { name owner { ${accountFields} } }`;
const pageInfoFields = "pageInfo { hasNextPage endCursor }";

/** A page of one repository's issues, oldest first, each with the first page of its assignees, blockers and sub-issues. */
export const repositoryIssuesQuery = `query RepositoryIssues($owner: String!, $name: String!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    name
    owner { ${accountFields} }
    issues(first: $first, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
      ${pageInfoFields}
      nodes {
        ${issueRefFields}
        assignees(first: $first) { ${pageInfoFields} nodes { login } }
        blockedBy(first: $first) { ${pageInfoFields} nodes { ${issueRefFields} } }
        subIssues(first: $first) { ${pageInfoFields} nodes { ${issueRefFields} } }
      }
    }
  }
}`;

export const repositoryIssuesSchema = z.object({
  repository: z
    .object({
      name: z.string(),
      owner: accountSchema,
      issues: connectionOf(issueSchema),
    })
    .nullable(),
});

/** A page of the repositories an account owns, by name. */
export const ownerRepositoriesQuery = `query OwnerRepositories($login: String!, $first: Int!, $after: String) {
  repositoryOwner(login: $login) {
    ${accountFields}
    repositories(first: $first, after: $after, ownerAffiliations: [OWNER], orderBy: { field: NAME, direction: ASC }) {
      ${pageInfoFields}
      nodes { name }
    }
  }
}`;

export const ownerRepositoriesSchema = z.object({
  repositoryOwner: z
    .object({
      __typename: z.enum(["Organization", "User"]),
      login: z.string(),
      repositories: connectionOf(z.object({ name: z.string() })),
    })
    .nullable(),
});

/** The issue connections a page can overflow, each read on its own when it has more than one page. */
export type IssueConnection = "assignees" | "blockedBy" | "subIssues";

/** The rest of one issue connection after `after`. */
export const issueConnectionQuery = (connection: IssueConnection): string => {
  const nodeFields = connection === "assignees" ? "login" : issueRefFields;

  return `query IssueConnection($owner: String!, $name: String!, $number: Int!, $first: Int!, $after: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      ${connection}(first: $first, after: $after) { ${pageInfoFields} nodes { ${nodeFields} } }
    }
  }
}`;
};

/** The data of an `issueConnectionQuery` response, for the connection `shape` names. */
const issueConnectionDataSchema = <Shape extends z.ZodRawShape>(shape: Shape) =>
  z.object({
    repository: z.object({ issue: z.object(shape).nullable() }).nullable(),
  });

export const assigneesConnectionSchema = issueConnectionDataSchema({
  assignees: connectionOf(userSchema),
});
export const blockedByConnectionSchema = issueConnectionDataSchema({
  blockedBy: connectionOf(issueRefSchema),
});
export const subIssuesConnectionSchema = issueConnectionDataSchema({
  subIssues: connectionOf(issueRefSchema),
});

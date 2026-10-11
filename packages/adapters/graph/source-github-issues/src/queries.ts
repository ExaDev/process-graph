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
  blocking: connectionOf(issueRefSchema),
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

/** An issue with the first page of each of its connections: assignees, the issues blocking it, the issues it blocks, and its sub-issues. */
const issueFields = `${issueRefFields}
        assignees(first: $first) { ${pageInfoFields} nodes { login } }
        blockedBy(first: $first) { ${pageInfoFields} nodes { ${issueRefFields} } }
        blocking(first: $first) { ${pageInfoFields} nodes { ${issueRefFields} } }
        subIssues(first: $first) { ${pageInfoFields} nodes { ${issueRefFields} } }`;

/** A page of one repository's issues, in the states, labels and order the variables give, each with the first page of its connections. */
export const repositoryIssuesQuery = `query RepositoryIssues($owner: String!, $name: String!, $first: Int!, $after: String, $states: [IssueState!]!, $labels: [String!], $orderBy: IssueOrder!) {
  repository(owner: $owner, name: $name) {
    name
    owner { ${accountFields} }
    issues(first: $first, after: $after, states: $states, labels: $labels, orderBy: $orderBy) {
      ${pageInfoFields}
      nodes {
        ${issueFields}
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

/** A page of the repositories an account owns, by name, with what a scope picker shows of each. A sync reads the names; a scope listing reads the rest too, so both share one request. */
export const ownerRepositoriesQuery = `query OwnerRepositories($login: String!, $first: Int!, $after: String) {
  repositoryOwner(login: $login) {
    ${accountFields}
    repositories(first: $first, after: $after, ownerAffiliations: [OWNER], orderBy: { field: NAME, direction: ASC }) {
      ${pageInfoFields}
      nodes { name description url isArchived }
    }
  }
}`;

const repositoryEntrySchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  url: z.url(),
  isArchived: z.boolean(),
});

export type RepositoryEntry = z.infer<typeof repositoryEntrySchema>;

export const ownerRepositoriesSchema = z.object({
  repositoryOwner: z
    .object({
      __typename: z.enum(["Organization", "User"]),
      login: z.string(),
      repositories: connectionOf(repositoryEntrySchema),
    })
    .nullable(),
});

/** The viewer's own account and a page of the organisations it belongs to, as a scope picker shows them. */
export const viewerScopesQuery = `query ViewerScopes($first: Int!, $after: String) {
  viewer {
    login
    name
    url
    organizations(first: $first, after: $after) {
      ${pageInfoFields}
      nodes { login name description url archivedAt }
    }
  }
}`;

const organisationEntrySchema = z.object({
  login: z.string(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  url: z.url(),
  archivedAt: z.string().nullable(),
});

export type OrganisationEntry = z.infer<typeof organisationEntrySchema>;

export const viewerScopesSchema = z.object({
  viewer: z.object({
    login: z.string(),
    name: z.string().nullable(),
    url: z.url(),
    organizations: connectionOf(organisationEntrySchema),
  }),
});

/** A page of a Projects v2 board's items, each issue with the first page of its connections. Other kinds of item (pull requests, draft issues) are named only by type, since they are not issues. */
export const projectItemsQuery = `query ProjectItems($login: String!, $number: Int!, $first: Int!, $after: String) {
  repositoryOwner(login: $login) {
    ${accountFields}
    ... on ProjectV2Owner {
      projectV2(number: $number) {
        items(first: $first, after: $after) {
          ${pageInfoFields}
          nodes {
            content {
              __typename
              ... on Issue {
                ${issueFields}
              }
            }
          }
        }
      }
    }
  }
}`;

/** An item's content: an issue, or another kind of item named only by its type. */
const itemContentSchema = z.union([
  issueSchema.extend({ __typename: z.literal("Issue") }),
  z.object({ __typename: z.enum(["PullRequest", "DraftIssue"]) }),
]);

export const projectItemsSchema = z.object({
  repositoryOwner: z
    .object({
      __typename: z.enum(["Organization", "User"]),
      login: z.string(),
      projectV2: z
        .object({
          items: connectionOf(
            z.object({ content: itemContentSchema.nullable() }),
          ),
        })
        .nullable(),
    })
    .nullable(),
});

/** The issue connections a page can overflow, each read on its own when it has more than one page. */
export type IssueConnection =
  "assignees" | "blockedBy" | "blocking" | "subIssues";

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
export const blockingConnectionSchema = issueConnectionDataSchema({
  blocking: connectionOf(issueRefSchema),
});
export const subIssuesConnectionSchema = issueConnectionDataSchema({
  subIssues: connectionOf(issueRefSchema),
});

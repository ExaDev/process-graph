/**
 * The exit status of every command, by meaning. A script tells the outcomes apart without reading the output: a model with problems is not a failure to run, and neither is an element that does not exist.
 *
 * - `success`: the command did what it was asked, and for `validate` and `cycles`, found nothing wrong.
 * - `failure`: anything not listed below, such as a store that cannot be opened.
 * - `usage`: the command line is wrong: an unknown command or option, a missing argument, a value outside its choices.
 * - `notFound`: the model, an element or another identifier named on the command line does not exist.
 * - `invalidModel`: the model has problems: `validate` found issues, `cycles` found an illegal cycle, a reasoning command met an illegal cycle, or the store rejected a change that would leave the model invalid.
 * - `sourceFailure`: a source refused the sync: bad credentials, a rate limit or a scope it does not accept.
 * - `missingPeers`: the `process-graph` bin could not start because optional peer dependencies the command line needs are not installed beside it.
 */
export const exitCodes = {
  success: 0,
  failure: 1,
  usage: 2,
  notFound: 3,
  invalidModel: 4,
  sourceFailure: 5,
  missingPeers: 6,
} as const;

/** One of the exit statuses in `exitCodes`. */
export type ExitCode = (typeof exitCodes)[keyof typeof exitCodes];

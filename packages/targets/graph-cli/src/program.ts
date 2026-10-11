import {
  overlayStatuses,
  participantKinds,
  type OverlayStatus,
  type ParticipantKind,
} from "@exadev/process-graph-schema";
import { Argument, Command, Option } from "commander";
import { add, setState, type Addition } from "./edit.ts";
import { failureOf } from "./errors.ts";
import { exitCodes, type ExitCode } from "./exit-codes.ts";
import type { CliPorts } from "./ports.ts";
import {
  blocked,
  cycles,
  handoffsOf,
  impactOf,
  path,
  ready,
  why,
} from "./queries.ts";
import {
  renderAdded,
  renderBlocked,
  renderCycles,
  renderHandoffs,
  renderImpact,
  renderPath,
  renderReady,
  renderSet,
  renderSync,
  renderValidate,
  renderWhy,
} from "./render.ts";
import type { GraphSession } from "./session.ts";
import {
  formatNames,
  show,
  viewNames,
  type FormatName,
  type ViewName,
} from "./show.ts";
import { sync } from "./sync.ts";
import { terminalJson, terminalText } from "./terminal-text.ts";
import { validateDocument, validateStored } from "./validate.ts";

/** How the program presents itself. */
export interface ProgramIdentity {
  /** The command name shown in help and usage, such as `process-graph`, or `sb graph` when embedded. */
  readonly name: string;
  /** The version `--version` prints. */
  readonly version: string;
}

/** The model a command works on when `--model` is not given. */
export const defaultModelId = "default";

const exitStatusHelp = `
Exit status:
  ${String(exitCodes.success)}  success; for validate and cycles, nothing wrong was found
  ${String(exitCodes.failure)}  failure not listed below
  ${String(exitCodes.usage)}  usage error: unknown command or option, missing argument, value outside its choices
  ${String(exitCodes.notFound)}  the model, an element or another identifier named does not exist
  ${String(exitCodes.invalidModel)}  the model has problems: validation issues, an illegal cycle, or a change the store rejected
  ${String(exitCodes.sourceFailure)}  a source refused the sync: credentials, rate limit or scope

Every command writes JSON with --json. The store is a SQLite file, chosen with --data.`;

/** What one command produced: the value `--json` writes, the text written otherwise, and the exit status. */
interface Outcome {
  readonly json: unknown;
  readonly text: string;
  readonly exitCode?: ExitCode;
}

/** The options every command shares, read from the program. */
interface GlobalOptions {
  readonly data: string;
  readonly model: string;
  readonly json: boolean;
}

const readGlobals = (command: Command, ports: CliPorts): GlobalOptions => {
  const options: Record<string, unknown> = command.optsWithGlobals();
  const { data, model, json } = options;

  return {
    data: typeof data === "string" ? data : ports.defaultDataPath,
    model: typeof model === "string" ? model : defaultModelId,
    json: json === true,
  };
};

const isOneOf = <T extends string>(
  values: readonly T[],
  value: unknown,
): value is T => values.some((candidate) => candidate === value);

/** Reads an option whose choices commander has already checked, narrowing it to its type. */
const choice = <T extends string>(
  values: readonly T[],
  value: unknown,
  name: string,
): T => {
  if (!isOneOf(values, value)) {
    throw new Error(`--${name} was not checked against its choices`);
  }

  return value;
};

/**
 * Runs the command line with the given arguments, writing only through the ports, and resolves with the exit status. It never exits the process or reads its arguments itself, so a test or a host program such as Switchboard runs it as a function.
 * @param args - The arguments after the program name, such as `["ready", "--json"]`.
 * @param ports - Output, store, sources, facts and the abort signal.
 * @param identity - The name and version the program presents.
 * @returns The exit status, one of `exitCodes`.
 */
export const runCli = async (
  args: readonly string[],
  ports: CliPorts,
  identity: ProgramIdentity,
): Promise<ExitCode> => {
  let exitCode: ExitCode = exitCodes.success;
  // The one boundary every byte the command line writes crosses: results, diagrams, help, usage errors and failures all carry text from sources (titles, labels, actor names), which must never act on the terminal they are written to.
  const writeOut = (text: string): void => {
    ports.stdout(terminalText(text));
  };
  const writeErr = (text: string): void => {
    ports.stderr(terminalText(text));
  };

  const program = new Command(identity.name);
  program
    .description(
      "Sync work from its sources into a process model, and ask what is ready, blocked, on the critical path or handed off, why, and what it looks like as a diagram.",
    )
    .version(identity.version)
    .configureOutput({ writeOut, writeErr })
    .configureHelp({ showGlobalOptions: true })
    .exitOverride()
    .option(
      "--data <path>",
      "the SQLite file the store keeps",
      ports.defaultDataPath,
    )
    .option("--model <id>", "the model in the store", defaultModelId)
    .option("--json", "write the result as JSON")
    .addHelpText("after", exitStatusHelp)
    .showHelpAfterError();

  /** Writes a command's result, as JSON or text, and records its exit status. */
  const respond = (globals: GlobalOptions, outcome: Outcome): void => {
    writeOut(globals.json ? terminalJson(outcome.json) : outcome.text);
    exitCode = outcome.exitCode ?? exitCodes.success;
  };

  /** Opens the store for one command, runs it, writes its result and records its exit status; the store is closed whatever happens. */
  const withSession =
    <Args extends unknown[]>(
      handler: (session: GraphSession, ...values: Args) => Promise<Outcome>,
    ) =>
    async (command: Command, ...values: Args): Promise<void> => {
      const globals = readGlobals(command, ports);
      const opened = await ports.openStore(globals.data);
      try {
        const outcome = await handler(
          {
            store: opened.client,
            modelId: globals.model,
            facts: ports.facts,
            signal: ports.signal,
          },
          ...values,
        );
        respond(globals, outcome);
      } finally {
        await opened.close();
      }
    };

  program
    .command("sync")
    .description(
      "read the scopes from their sources and merge them into the model",
    )
    .argument(
      "<scope...>",
      "source-qualified scopes, such as github:owner or github:owner/repo",
    )
    .option("--after <cursor>", "resume an interrupted sync after this cursor")
    .action(
      async (
        scopes: readonly string[],
        options: Record<string, unknown>,
        command: Command,
      ) => {
        const { after } = options;
        await withSession(async (session) => {
          const result = await sync(
            session,
            ports.source,
            typeof after === "string" ? { scopes, after } : { scopes },
          );

          return { json: result, text: renderSync(result) };
        })(command);
      },
    );

  program
    .command("ready")
    .description("list the work that can start now")
    .action(async (_options: unknown, command: Command) => {
      await withSession(async (session) => {
        const result = await ready(session);

        return { json: result, text: renderReady(result) };
      })(command);
    });

  program
    .command("blocked")
    .description("list the open work an element is waiting on")
    .argument("<id>", "the element")
    .action(async (id: string, _options: unknown, command: Command) => {
      await withSession(async (session) => {
        const result = await blocked(session, id);

        return { json: result, text: renderBlocked(result) };
      })(command);
    });

  program
    .command("impact")
    .description("list the live work that depends on an element")
    .argument("<id>", "the element")
    .action(async (id: string, _options: unknown, command: Command) => {
      await withSession(async (session) => {
        const result = await impactOf(session, id);

        return { json: result, text: renderImpact(result) };
      })(command);
    });

  program
    .command("path")
    .description(
      "list the critical path: the longest chain of work still ahead",
    )
    .action(async (_options: unknown, command: Command) => {
      await withSession(async (session) => {
        const result = await path(session);

        return { json: result, text: renderPath(result) };
      })(command);
    });

  program
    .command("cycles")
    .description(
      "list the cycles no decision closes; exits with the invalid model status when there are any",
    )
    .action(async (_options: unknown, command: Command) => {
      await withSession(async (session) => {
        const result = await cycles(session);

        return {
          json: result,
          text: renderCycles(result),
          exitCode:
            result.cycles.length === 0
              ? exitCodes.success
              : exitCodes.invalidModel,
        };
      })(command);
    });

  program
    .command("handoffs")
    .description("list the transitions from one actor's work to another's")
    .action(async (_options: unknown, command: Command) => {
      await withSession(async (session) => {
        const result = await handoffsOf(session);

        return { json: result, text: renderHandoffs(result) };
      })(command);
    });

  program
    .command("why")
    .description(
      "explain an element's status: the rule that decided it, its needs and the blocked-by chain",
    )
    .argument("<id>", "the element")
    .action(async (id: string, _options: unknown, command: Command) => {
      await withSession(async (session) => {
        const result = await why(session, id);

        return { json: result, text: renderWhy(result) };
      })(command);
    });

  program
    .command("show")
    .description("draw the model as a view")
    .addOption(
      new Option("--view <view>", "the view to draw")
        .choices(viewNames)
        .default("flowchart"),
    )
    .addOption(
      new Option("--format <format>", "the format to write")
        .choices(formatNames)
        .default("mermaid"),
    )
    .option(
      "--subject <entity>",
      "the entity a state view follows; defaults to the model's declared state machine projection",
    )
    .option(
      "--scenario <transition...>",
      "the transitions a sequence view follows, in order; defaults to the model's declared sequence projection",
    )
    .action(async (options: Record<string, unknown>, command: Command) => {
      const view: ViewName = choice(viewNames, options.view, "view");
      const format: FormatName = choice(formatNames, options.format, "format");
      const { subject, scenario } = options;
      await withSession(async (session) => {
        const result = await show(session, {
          view,
          format,
          ...(typeof subject === "string" ? { subject } : {}),
          ...(Array.isArray(scenario)
            ? {
                scenario: scenario.filter(
                  (id): id is string => typeof id === "string",
                ),
              }
            : {}),
        });

        return {
          json:
            format === "json"
              ? result.projection
              : { view, format, text: result.text },
          text: result.text,
        };
      })(command);
    });

  const addCommand = program
    .command("add")
    .description("add a record to the model, creating the model if needed");

  const added = async (
    command: Command,
    addition: Addition,
    kind: string,
  ): Promise<void> =>
    withSession(async (session) => {
      const written = await add(session, addition);

      return {
        json: {
          added: kind,
          id: addition.record.id,
          revision: written.revision,
        },
        text: renderAdded(kind, addition.record.id, written),
      };
    })(command);

  addCommand
    .command("participant")
    .description(
      "add a participant: a role or system that acts, or an entity with a lifecycle",
    )
    .argument("<id>", "its identifier")
    .argument("<label>", "its label")
    .addOption(
      new Option("--kind <kind>", "what it is")
        .choices(participantKinds)
        .default("role"),
    )
    .action(
      async (
        id: string,
        label: string,
        options: Record<string, unknown>,
        command: Command,
      ) => {
        const kind: ParticipantKind = choice(
          participantKinds,
          options.kind,
          "kind",
        );
        await added(
          command,
          { kind: "participant", record: { id, label, kind } },
          "participant",
        );
      },
    );

  addCommand
    .command("activity")
    .description("add an activity: a step of work")
    .argument("<id>", "its identifier")
    .argument("<label>", "its label")
    .option("--actor <participant>", "the role or system that does it")
    .action(
      async (
        id: string,
        label: string,
        options: Record<string, unknown>,
        command: Command,
      ) => {
        const { actor } = options;
        await added(
          command,
          {
            kind: "element",
            record: {
              kind: "activity",
              id,
              label,
              ...(typeof actor === "string" ? { actor } : {}),
            },
          },
          "activity",
        );
      },
    );

  addCommand
    .command("decision")
    .description("add a decision: a point where the flow branches")
    .argument("<id>", "its identifier")
    .argument("<label>", "its label, the question it asks")
    .option("--actor <participant>", "the role or system that decides")
    .action(
      async (
        id: string,
        label: string,
        options: Record<string, unknown>,
        command: Command,
      ) => {
        const { actor } = options;
        await added(
          command,
          {
            kind: "element",
            record: {
              kind: "decision",
              id,
              label,
              ...(typeof actor === "string" ? { actor } : {}),
            },
          },
          "decision",
        );
      },
    );

  addCommand
    .command("state")
    .description("add a state an entity rests in")
    .argument("<id>", "its identifier")
    .argument("<label>", "its label")
    .option("--parent <state>", "the state it is nested in")
    .action(
      async (
        id: string,
        label: string,
        options: Record<string, unknown>,
        command: Command,
      ) => {
        const { parent } = options;
        await added(
          command,
          {
            kind: "element",
            record: {
              kind: "state",
              id,
              label,
              ...(typeof parent === "string" ? { parent } : {}),
            },
          },
          "state",
        );
      },
    );

  addCommand
    .command("event")
    .description("add an event that can trigger a transition")
    .argument("<id>", "its identifier")
    .argument("<name>", "its name")
    .action(
      async (id: string, name: string, _options: unknown, command: Command) => {
        await added(command, { kind: "event", record: { id, name } }, "event");
      },
    );

  addCommand
    .command("artefact")
    .description("add an artefact that activities consume or produce")
    .argument("<id>", "its identifier")
    .argument("<name>", "its name")
    .option(
      "--deliverable",
      "mark it as an output the process exists to deliver",
    )
    .action(
      async (
        id: string,
        name: string,
        options: Record<string, unknown>,
        command: Command,
      ) => {
        await added(
          command,
          {
            kind: "artefact",
            record:
              options.deliverable === true
                ? { id, name, deliverable: true }
                : { id, name },
          },
          "artefact",
        );
      },
    );

  addCommand
    .command("transition")
    .description("add a transition: the target waits on the source")
    .argument("<source>", "the element that comes first")
    .argument("<target>", "the element that follows")
    .option(
      "--id <id>",
      "its identifier; <source>-><target> when not given, as a source names its transitions",
    )
    .option("--guard <label>", "the label of the branch it takes")
    .option("--trigger <event>", "the event that fires it")
    .action(
      async (
        source: string,
        target: string,
        options: Record<string, unknown>,
        command: Command,
      ) => {
        const { id, guard, trigger } = options;
        await added(
          command,
          {
            kind: "transition",
            record: {
              id: typeof id === "string" ? id : `${source}->${target}`,
              source,
              target,
              ...(typeof guard === "string" ? { guard } : {}),
              ...(typeof trigger === "string" ? { trigger } : {}),
            },
          },
          "transition",
        );
      },
    );

  program
    .command("set")
    .description("set an element's run state")
    .argument("<id>", "the element")
    .addArgument(
      new Argument("<state>", "its run state").choices(overlayStatuses),
    )
    .action(
      async (
        id: string,
        state: string,
        _options: unknown,
        command: Command,
      ) => {
        const status: OverlayStatus = choice(overlayStatuses, state, "state");
        await withSession(async (session) => {
          const result = await setState(session, id, status);

          return { json: result, text: renderSet(result) };
        })(command);
      },
    );

  program
    .command("validate")
    .description(
      "check the stored model, or a model file, for problems; exits with the invalid model status when there are any",
    )
    .argument("[file]", "a model as JSON, checked instead of the stored model")
    .action(
      async (file: string | undefined, _options: unknown, command: Command) => {
        const outcome = (
          result: ReturnType<typeof validateDocument>,
        ): Outcome => ({
          json: result,
          text: renderValidate(result),
          exitCode: result.valid ? exitCodes.success : exitCodes.invalidModel,
        });
        if (file === undefined) {
          await withSession(async (session) =>
            outcome(await validateStored(session)),
          )(command);

          return;
        }
        respond(
          readGlobals(command, ports),
          outcome(validateDocument(await ports.readFile(file, ports.signal))),
        );
      },
    );

  try {
    await program.parseAsync(args, { from: "user" });
  } catch (error) {
    const failure = failureOf(error);
    if (failure.message !== "") {
      writeErr(`${failure.message}\n`);
    }

    return failure.exitCode;
  }

  return exitCode;
};

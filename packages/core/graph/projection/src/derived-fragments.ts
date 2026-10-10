import type {
  FragmentOperator,
  IdSpace,
  Model,
} from "@exadev/process-graph-schema";
import {
  buildDag,
  stronglyConnectedComponents,
} from "@exadev/process-graph-dag";
import { outgoingMap, type TransitionOf } from "./chains.ts";

/** One operand of a fragment the projection derives from the model's structure: the guard of the branch it follows and the elements of that branch on the scenario path. */
interface DerivedOperand<I extends IdSpace> {
  readonly guard: string | undefined;
  readonly body: readonly I["element"][];
}

/** A fragment read off the model's structure rather than authored: an `alt` or `opt` from a decision's branches, a `loop` from a decision's way back to earlier work, a `par` from a fork's branches. */
export interface DerivedFragment<I extends IdSpace> {
  /** The decision or fork the fragment comes from. */
  readonly element: I["element"];
  readonly operator: FragmentOperator;
  readonly operands: readonly DerivedOperand<I>[];
}

/** A choice or a split needs at least two branches, and an `opt` is exactly a choice between doing something and skipping it. */
const minBranches = 2;

/** Elements reachable from `start` by following transitions other than those in `skip`, `start` included. The walk uses an explicit stack, and `observe` is told of each element as it is expanded. */
const reachable = <I extends IdSpace>(
  start: I["element"],
  outgoing: ReadonlyMap<I["element"], readonly TransitionOf<I>[]>,
  skip: ReadonlySet<I["transition"]>,
  observe: ((element: I["element"]) => void) | undefined,
): ReadonlySet<I["element"]> => {
  const seen = new Set<I["element"]>([start]);
  const stack: I["element"][] = [start];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    observe?.(next);
    for (const transition of outgoing.get(next) ?? []) {
      if (!skip.has(transition.id) && !seen.has(transition.target)) {
        seen.add(transition.target);
        stack.push(transition.target);
      }
    }
  }

  return seen;
};

/**
 * The fragments the model's structure implies at the decisions and forks the scenario passes, restricted to the elements on the scenario path.
 *
 * A transition leaving a decision is a loop transition when its target can reach the decision again, the same rule `graph-domain` uses for a legal cycle. Since the decision reaches that target through the transition, this holds exactly when the target is in the decision's strongly connected component, which is found for every element at once by one pass of Tarjan's algorithm. A decision with loop transitions yields one `loop` whose body is its whole component, which is every element on a cycle through it, guarded by its loop transitions' guards joined with "or", since taking any of them goes round again. The decision's other (forward) branches, when there are at least two, yield an `alt` with one operand per branch; when there are exactly two and one of them goes straight to where the branches meet, the fragment is an `opt` around the other. A fork pseudo-state's branches yield a `par`. A branch's body is the elements reachable from it, over forward transitions only, that are not reachable from every branch: those that every branch reaches lie after the branches meet.
 *
 * The work is one pass over every element and transition for the components, then, for each decision or fork the scenario passes, one walk over forward transitions per forward branch. Loops add no walks, and decisions and forks off the path add none.
 * @param model - The model the scenario runs through.
 * @param onPath - The elements the scenario passes, to which every body is restricted.
 * @param observe - Told of each element a branch walk expands, so a caller can measure the work done.
 * @returns Derived fragments in model order of the decision or fork they come from, each decision's loop before its alternatives.
 */
export const deriveFragments = <I extends IdSpace>(
  model: Model<I>,
  onPath: ReadonlySet<I["element"]>,
  observe?: (element: I["element"]) => void,
): readonly DerivedFragment<I>[] => {
  const outgoing = outgoingMap(model);
  const graph = buildDag(
    model.elements.map((element) => element.id),
    (id) => (outgoing.get(id) ?? []).map((transition) => transition.target),
  );
  const component = new Map<I["element"], readonly I["element"][]>();
  for (const members of stronglyConnectedComponents(graph)) {
    for (const member of members) {
      component.set(member, members);
    }
  }

  const loops = new Set<I["transition"]>();
  for (const element of model.elements) {
    if (element.kind !== "decision") {
      continue;
    }
    // Elements share a component exactly when they map to the same members list, so this is a constant-time test per transition.
    const own = component.get(element.id);
    for (const transition of outgoing.get(element.id) ?? []) {
      if (own !== undefined && component.get(transition.target) === own) {
        loops.add(transition.id);
      }
    }
  }

  const onPathOnly = (
    elements: Readonly<Iterable<I["element"]>>,
  ): I["element"][] => [...elements].filter((id) => onPath.has(id));

  /** One operand per branch, with the branches' shared tail removed, and whether each branch goes straight to where the branches meet. */
  const branchesOf = (
    branches: readonly TransitionOf<I>[],
  ): readonly {
    readonly operand: DerivedOperand<I>;
    readonly direct: boolean;
  }[] => {
    const reach = branches.map((branch) => ({
      branch,
      elements: reachable(branch.target, outgoing, loops, observe),
    }));
    // An element every branch reaches lies after the branches meet; it is enough to test those the first branch reaches.
    const [head] = reach;
    const shared = new Set<I["element"]>(
      head === undefined
        ? []
        : [...head.elements].filter((id) =>
            reach.every(({ elements }) => elements.has(id)),
          ),
    );

    return reach.map(({ branch, elements }) => ({
      operand: {
        guard: branch.guard,
        body: onPathOnly([...elements].filter((id) => !shared.has(id))),
      },
      direct: shared.has(branch.target),
    }));
  };

  const derived: DerivedFragment<I>[] = [];
  for (const element of model.elements) {
    if (!onPath.has(element.id)) {
      continue;
    }
    const leaving = outgoing.get(element.id) ?? [];
    if (element.kind === "decision") {
      const back = leaving.filter((transition) => loops.has(transition.id));
      const own = component.get(element.id);
      if (back.length > 0 && own !== undefined) {
        const guards = [
          ...new Set(
            back.flatMap((transition) =>
              transition.guard === undefined ? [] : [transition.guard],
            ),
          ),
        ];
        derived.push({
          element: element.id,
          operator: "loop",
          operands: [
            {
              guard: guards.length > 0 ? guards.join(" or ") : undefined,
              body: onPathOnly(own),
            },
          ],
        });
      }
      const forward = leaving.filter((transition) => !loops.has(transition.id));
      if (forward.length < minBranches) {
        continue;
      }
      const branches = branchesOf(forward);
      const [taken, ...others] = branches.filter(({ direct }) => !direct);
      derived.push(
        branches.length === minBranches &&
          taken !== undefined &&
          others.length === 0
          ? { element: element.id, operator: "opt", operands: [taken.operand] }
          : {
              element: element.id,
              operator: "alt",
              operands: branches.map(({ operand }) => operand),
            },
      );
    } else if (
      element.kind === "pseudo" &&
      element.role === "fork" &&
      leaving.length >= minBranches
    ) {
      derived.push({
        element: element.id,
        operator: "par",
        operands: branchesOf(leaving).map(({ operand }) => operand),
      });
    }
  }

  return derived;
};

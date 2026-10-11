import type {
  SequenceDiagram as SequenceDiagramView,
  SequenceItem,
  SequenceMessage,
} from "@exadev/process-graph-projection";
import type { IdSpace } from "@exadev/process-graph-schema";
import { useId, type ReactElement } from "react";
import { visuallyHidden } from "./base.css.ts";
import {
  arrowFilled,
  arrowOpen,
  diagramText,
  fragmentDivider,
  fragmentFrame,
  fragmentTag,
  lifelineHead,
  lifelineLine,
  messageLabel,
  messageLine,
  sequenceCaption,
  sequenceFigure,
  sequenceSvg,
} from "./sequence.css.ts";

/** The unit every dimension below is a multiple of: the same grid `graph-layout` places nodes on, so a sequence diagram and a laid-out view share a scale. One unit is also the gap between a label and its arrow, the inset of each level of fragment nesting, and the size of an arrowhead. */
const GRID = 8;

/** Each dimension of the drawing, in grid units. */
const units = {
  /** The space around the drawing. */
  margin: 2,
  /** A lifeline's head: wide enough for a participant's name on one line. */
  headWidth: 16,
  headHeight: 5,
  /** The distance between neighbouring lifelines: a head's width plus room for a message label between them. */
  lifelineGap: 20,
  /** One message, or a fragment's heading, per row: room for a label above the arrow. */
  row: 6,
  /** A self-message's loop: how far it reaches to the right of its lifeline, and how far it drops before returning. */
  selfReach: 4,
  selfDrop: 2,
  /** A fragment's operator tag. */
  tagWidth: 6,
  tagHeight: 3,
};

const MARGIN = units.margin * GRID;
const HEAD_WIDTH = units.headWidth * GRID;
const HEAD_HEIGHT = units.headHeight * GRID;
const LIFELINE_GRID = units.lifelineGap * GRID;
const ROW = units.row * GRID;
const SELF_REACH = units.selfReach * GRID;
const SELF_DROP = units.selfDrop * GRID;
const TAG_WIDTH = units.tagWidth * GRID;
const TAG_HEIGHT = units.tagHeight * GRID;

/** A text baseline sits this far below the middle of the box it is centred in, so the glyphs look centred. */
const BASELINE_DROP = GRID / 2;

interface PlacedMessage<I extends IdSpace> {
  readonly message: SequenceMessage<I>;
  readonly y: number;
}

interface PlacedFragment {
  readonly operator: string;
  readonly depth: number;
  readonly top: number;
  readonly bottom: number;
  /** Each operand's guard and the row it starts on. */
  readonly operands: readonly { readonly guard?: string; readonly y: number }[];
}

interface Placement<I extends IdSpace> {
  readonly messages: readonly PlacedMessage<I>[];
  readonly fragments: readonly PlacedFragment[];
  readonly rows: number;
}

/**
 * Gives each message a row and each fragment the rows it spans. A fragment takes a row of its own for its tag and first guard, and another for each later operand's guard, so no label overlaps an arrow.
 */
const place = <I extends IdSpace>(
  items: readonly SequenceItem<I>[],
): Placement<I> => {
  const messages: PlacedMessage<I>[] = [];
  const fragments: PlacedFragment[] = [];
  let row = 0;
  const walk = (level: readonly SequenceItem<I>[], depth: number): void => {
    for (const item of level) {
      if (item.kind === "message") {
        row += 1;
        messages.push({ message: item.message, y: row * ROW });
        continue;
      }
      const top = row * ROW + ROW / 2;
      const operands: { guard?: string; y: number }[] = [];
      for (const operand of item.operands) {
        row += 1;
        operands.push({
          ...(operand.guard === undefined ? {} : { guard: operand.guard }),
          y: row * ROW,
        });
        walk(operand.items, depth + 1);
      }
      fragments.push({
        operator: item.operator,
        depth,
        top,
        bottom: row * ROW + ROW / 2,
        operands,
      });
    }
  };
  walk(items, 0);

  return { messages, fragments, rows: row + 1 };
};

const describeMessage = <I extends IdSpace>(
  message: SequenceMessage<I>,
  labelOf: (actor: I["actor"]) => string,
): string =>
  `${labelOf(message.from)} to ${labelOf(message.to)}: ${message.label}`;

/** The text alternative: the items as nested lists, in scenario order. */
const Steps = <I extends IdSpace>(props: {
  readonly items: readonly SequenceItem<I>[];
  readonly labelOf: (actor: I["actor"]) => string;
}): ReactElement => {
  const { items, labelOf } = props;

  return (
    <ol>
      {items.map((item) =>
        item.kind === "message" ? (
          <li key={item.message.transition}>
            {describeMessage(item.message, labelOf)}
          </li>
        ) : (
          <li key={item.fragment ?? item.element}>
            {item.operator}
            <ol>
              {item.operands.map((operand, index) => (
                <li key={index}>
                  {operand.guard === undefined ? "" : `[${operand.guard}] `}
                  <Steps items={operand.items} labelOf={labelOf} />
                </li>
              ))}
            </ol>
          </li>
        ),
      )}
    </ol>
  );
};

export interface SequenceDiagramProps<I extends IdSpace> {
  /** The diagram from `toSequence`. */
  readonly diagram: SequenceDiagramView<I>;
  /** The name a lifeline is drawn with. */
  readonly labelOf: (actor: I["actor"]) => string;
  /** The diagram's caption, which also names it for assistive technology. */
  readonly title: string;
}

/**
 * A sequence diagram drawn as SVG: a lifeline per actor in order of first appearance, a message per row as an arrow between lifelines (a loop for a self-message, dashed for a reply, an open head for an asynchronous message), and each fragment as a frame with its operator and operand guards. React Flow has no lifeline layout, so the arrangement is fixed by the diagram's own order. The drawing is hidden from assistive technology, which reads the same steps from a visually hidden list instead.
 * @param props - The diagram, the lifelines' names and a caption.
 * @returns A `figure` holding the caption, the drawing and its text alternative.
 */
export const SequenceDiagram = <I extends IdSpace>(
  props: SequenceDiagramProps<I>,
): ReactElement => {
  const { diagram, labelOf, title } = props;
  const id = useId();
  const caption = `${id}-caption`;
  const filled = `${id}-filled`;
  const open = `${id}-open`;
  const { messages, fragments, rows } = place(diagram.items);
  const xOf = new Map(
    diagram.lifelines.map((actor, index) => [
      actor,
      MARGIN + HEAD_WIDTH / 2 + index * LIFELINE_GRID,
    ]),
  );
  const at = (actor: I["actor"]): number => {
    const x = xOf.get(actor);
    if (x === undefined) {
      throw new Error(
        `"${actor}" sends or receives a message but has no lifeline`,
      );
    }

    return x;
  };
  const width =
    2 * MARGIN +
    HEAD_WIDTH +
    Math.max(diagram.lifelines.length - 1, 0) * LIFELINE_GRID;
  const top = MARGIN + HEAD_HEIGHT;
  const height = top + rows * ROW + MARGIN;

  return (
    <figure className={sequenceFigure} aria-labelledby={caption}>
      <figcaption id={caption} className={sequenceCaption}>
        {title}
      </figcaption>
      <svg
        aria-hidden="true"
        className={sequenceSvg}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <defs>
          <marker
            id={filled}
            viewBox={`0 0 ${GRID} ${GRID}`}
            refX={GRID}
            refY={GRID / 2}
            markerWidth={GRID}
            markerHeight={GRID}
            orient="auto-start-reverse"
          >
            <path
              className={arrowFilled}
              d={`M 0 0 L ${GRID} ${GRID / 2} L 0 ${GRID} z`}
            />
          </marker>
          <marker
            id={open}
            viewBox={`0 0 ${GRID} ${GRID}`}
            refX={GRID}
            refY={GRID / 2}
            markerWidth={GRID}
            markerHeight={GRID}
            orient="auto-start-reverse"
          >
            <path
              className={arrowOpen}
              d={`M 0 0 L ${GRID} ${GRID / 2} L 0 ${GRID}`}
            />
          </marker>
        </defs>
        {fragments.map((fragment) => {
          const inset = MARGIN / 2 + fragment.depth * GRID;
          const y = top + fragment.top;

          return (
            <g
              key={`${fragment.operator}-${fragment.top}`}
              data-fragment={fragment.operator}
            >
              <rect
                className={fragmentFrame}
                x={inset}
                y={y}
                width={width - 2 * inset}
                height={fragment.bottom - fragment.top}
              />
              <rect
                className={fragmentTag}
                x={inset}
                y={y}
                width={TAG_WIDTH}
                height={TAG_HEIGHT}
              />
              <text
                className={diagramText}
                x={inset + TAG_WIDTH / 2}
                y={y + TAG_HEIGHT / 2 + BASELINE_DROP}
                textAnchor="middle"
              >
                {fragment.operator}
              </text>
              {fragment.operands.map((operand, index) => (
                <g key={operand.y}>
                  {index === 0 ? null : (
                    <line
                      className={fragmentDivider}
                      x1={inset}
                      x2={width - inset}
                      y1={top + operand.y - ROW / 2}
                      y2={top + operand.y - ROW / 2}
                    />
                  )}
                  {operand.guard === undefined ? null : (
                    <text
                      className={messageLabel}
                      x={inset + TAG_WIDTH + GRID}
                      y={
                        top +
                        operand.y -
                        ROW / 2 +
                        TAG_HEIGHT / 2 +
                        BASELINE_DROP
                      }
                    >
                      [{operand.guard}]
                    </text>
                  )}
                </g>
              ))}
            </g>
          );
        })}
        {diagram.lifelines.map((actor) => {
          const x = at(actor);

          return (
            <g key={actor} data-lifeline={actor}>
              <line
                className={lifelineLine}
                x1={x}
                x2={x}
                y1={top}
                y2={height - MARGIN}
              />
              <rect
                className={lifelineHead}
                x={x - HEAD_WIDTH / 2}
                y={MARGIN}
                width={HEAD_WIDTH}
                height={HEAD_HEIGHT}
              />
              <text
                className={diagramText}
                x={x}
                y={MARGIN + HEAD_HEIGHT / 2 + BASELINE_DROP}
                textAnchor="middle"
              >
                {labelOf(actor)}
              </text>
            </g>
          );
        })}
        {messages.map(({ message, y: row }) => {
          const from = at(message.from);
          const to = at(message.to);
          const y = top + row;
          const mode = message.mode ?? "sync";
          const marker = `url(#${mode === "sync" ? filled : open})`;

          return (
            <g
              key={message.transition}
              data-transition-id={message.transition}
              data-mode={mode}
            >
              {from === to ? (
                <path
                  className={messageLine}
                  data-mode={mode}
                  d={`M ${from} ${y} h ${SELF_REACH} v ${SELF_DROP} h ${-SELF_REACH}`}
                  markerEnd={marker}
                />
              ) : (
                <line
                  className={messageLine}
                  data-mode={mode}
                  x1={from}
                  x2={to}
                  y1={y}
                  y2={y}
                  markerEnd={marker}
                />
              )}
              <text
                className={messageLabel}
                x={from === to ? from + SELF_REACH + GRID : (from + to) / 2}
                y={y - GRID}
                textAnchor={from === to ? "start" : "middle"}
              >
                {message.label}
              </text>
            </g>
          );
        })}
      </svg>
      <div className={visuallyHidden}>
        <Steps items={diagram.items} labelOf={labelOf} />
      </div>
    </figure>
  );
};

import { Component, type ReactNode } from "react";
import { notice } from "./app.css.ts";

export interface ViewBoundaryProps {
  /** What the boundary shows a failure of, as in "The swimlane could not be drawn". */
  readonly name: string;
  /** Changing it clears a shown failure, so a different view or model is tried afresh. */
  readonly resetKey: string;
  readonly children: ReactNode;
}

interface ViewBoundaryState {
  readonly error: unknown;
  readonly failed: boolean;
}

/**
 * Shows why a view could not be drawn, such as a layout that failed, in place of the view, and keeps the rest of the app working. React catches render errors only in a class component, so this is one.
 */
export class ViewBoundary extends Component<
  ViewBoundaryProps,
  ViewBoundaryState
> {
  override state: ViewBoundaryState = { error: undefined, failed: false };

  /**
   * Records the error a child threw while rendering.
   * @param error - What the child threw.
   * @returns The failed state.
   */
  static getDerivedStateFromError(error: unknown): ViewBoundaryState {
    return { error, failed: true };
  }

  override componentDidUpdate(previous: ViewBoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ error: undefined, failed: false });
    }
  }

  override render(): ReactNode {
    const { error, failed } = this.state;
    if (!failed) {
      return this.props.children;
    }

    return (
      <p role="alert" className={notice.error} data-notice="view">
        {this.props.name} could not be drawn:{" "}
        {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }
}

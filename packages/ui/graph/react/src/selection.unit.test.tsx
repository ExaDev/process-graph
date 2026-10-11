import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { useGraphSelection, type GraphSelectionOptions } from "./selection.ts";

afterEach(cleanup);

const order = ["first", "second", "third"];

/** A list whose items are drawn without `itemProps`, as a canvas that renders its own items would. */
const Canvas = (props: GraphSelectionOptions<string>): ReactElement => {
  const { selected, containerProps } = useGraphSelection(order, props);

  return (
    <div {...containerProps} aria-label="Canvas">
      <output>{selected ?? "none"}</output>
    </div>
  );
};

describe("useGraphSelection options", () => {
  test("starts from the initial selection", () => {
    render(<Canvas initial="second" />);

    expect(screen.getByRole("status").textContent).toBe("second");
  });

  test("tells onChange of each selection a key makes", () => {
    const onChange = vi.fn<(id: string | undefined) => void>();
    render(<Canvas onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "End" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "Escape" });

    expect(onChange.mock.calls).toEqual([["third"], [undefined]]);
  });

  test("hands a keyboard move to the focus function in place of the items' own focus", () => {
    const focus = vi.fn<(id: string) => void>();
    render(<Canvas focus={focus} />);

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });

    expect(focus.mock.calls).toEqual([["first"], ["second"]]);
  });

  test("reads an owner's selection and leaves changing it to the owner", () => {
    const onChange = vi.fn<(id: string | undefined) => void>();
    const { rerender } = render(
      <Canvas selected="second" onChange={onChange} />,
    );

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "ArrowDown" });

    expect(onChange.mock.calls).toEqual([["third"]]);
    expect(screen.getByRole("status").textContent).toBe("second");

    rerender(<Canvas selected="third" onChange={onChange} />);

    expect(screen.getByRole("status").textContent).toBe("third");

    rerender(<Canvas selected={undefined} onChange={onChange} />);

    expect(screen.getByRole("status").textContent).toBe("none");
  });

  test("ignores keys it does not navigate with", () => {
    const onChange = vi.fn<(id: string | undefined) => void>();
    render(<Canvas onChange={onChange} />);

    fireEvent.keyDown(screen.getByRole("listbox"), { key: "a" });

    expect(onChange).not.toHaveBeenCalled();
  });
});

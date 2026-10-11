import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { Board } from "./test-support/board.tsx";
import { order } from "./test-support/order.ts";

afterEach(cleanup);

/** The board with the customer's submission done. */
const renderSubmitted = () =>
  render(<Board overlay={{ "a-submit": "done" }} />);

const process = () => screen.getByRole("listbox", { name: "Order process" });

const card = (label: string): HTMLElement => {
  const option = within(process())
    .getAllByRole("option")
    .find((candidate) => candidate.textContent.startsWith(label));
  if (option === undefined) {
    throw new Error(`no card for ${label}`);
  }

  return option;
};

describe("the unstyled components", () => {
  test("lanes group the work of each participant under its name", () => {
    renderSubmitted();

    const lanes = within(process())
      .getAllByRole("group")
      .filter((group) => group.hasAttribute("data-lane"));
    expect(lanes.map((lane) => lane.getAttribute("data-lane"))).toEqual([
      "customer",
      "shop",
      "provider",
    ]);
    expect(
      lanes.map((lane) => lane.getAttribute("aria-labelledby")),
    ).not.toContain(null);
    const shop = within(process()).getByRole("group", { name: "Shop" });
    expect(
      within(shop)
        .getAllByRole("option")
        .map((option) => option.getAttribute("data-element-id")),
    ).toEqual(["a-request", "d-authorised", "a-pack", "a-cancel"]);
  });

  test("each card shows its element's status as a badge and in data-status", () => {
    renderSubmitted();

    expect(card("Submit order").getAttribute("data-status")).toBe("done");
    expect(within(card("Submit order")).getByText("Done")).toBeTruthy();
    expect(within(card("Request payment")).getByText("Ready")).toBeTruthy();
    expect(
      within(card("Authorise or decline")).getByText("Blocked"),
    ).toBeTruthy();
  });

  test("a blocked element shows the open work it is blocked by", () => {
    renderSubmitted();

    expect(
      within(card("Pack and ship")).getByText("Blocked by Request payment"),
    ).toBeTruthy();
    expect(card("Request payment").textContent).not.toContain("Blocked by");
  });

  test("the critical path is marked on its cards", () => {
    renderSubmitted();

    expect(card("Request payment").hasAttribute("data-critical")).toBe(true);
    expect(
      within(card("Pack and ship")).getByText("Critical path"),
    ).toBeTruthy();
    expect(card("Cancel order and notify").hasAttribute("data-critical")).toBe(
      false,
    );
  });

  test("hand-offs list the transitions that change actor", () => {
    renderSubmitted();

    const handoffs = within(
      screen.getByRole("list", { name: "Hand-offs" }),
    ).getAllByRole("listitem");
    expect(handoffs.map((item) => item.textContent)).toEqual([
      "Submit order to Request payment (hand-off)",
      "Request payment to Authorise or decline (hand-off)",
      "Authorise or decline to Payment authorised? (hand-off)",
    ]);
    expect(handoffs.every((item) => item.hasAttribute("data-handoff"))).toBe(
      true,
    );
  });

  test("the legend names every status and the critical path", () => {
    renderSubmitted();

    const legend = screen.getByRole("list", { name: "Legend" });
    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual([
      "Done",
      "Unknown",
      "Skipped",
      "Ready",
      "Blocked",
      "Critical path",
    ]);
  });

  test("selecting a blocked element explains it in the detail panel", () => {
    renderSubmitted();

    fireEvent.click(card("Pack and ship"));

    const panel = screen.getByRole("complementary", { name: "Pack and ship" });
    expect(within(panel).getByText("Blocked")).toBeTruthy();
    expect(
      within(panel).getByText("It is still waiting on unfinished work."),
    ).toBeTruthy();
    const blockedBy = within(panel).getByRole("region", { name: "Blocked by" });
    expect(within(blockedBy).getByRole("listitem").textContent).toBe(
      "Request payment",
    );
    const impact = within(panel).getByRole("region", { name: "Impact" });
    expect(
      within(impact)
        .getAllByRole("listitem")
        .map((item) => item.textContent),
    ).toEqual(["End"]);
  });
});

describe("keyboard navigation", () => {
  test("one card is a tab stop, the first until something is selected", () => {
    renderSubmitted();

    const stops = within(process())
      .getAllByRole("option")
      .filter((option) => option.tabIndex === 0);
    expect(
      stops.map((option) => option.getAttribute("data-element-id")),
    ).toEqual(["a-submit"]);
  });

  test("arrow keys move the selection and focus through the shown elements", () => {
    renderSubmitted();

    fireEvent.keyDown(process(), { key: "ArrowDown" });
    expect(card("Submit order").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(card("Submit order"));

    fireEvent.keyDown(process(), { key: "ArrowRight" });
    expect(card("Request payment").getAttribute("aria-selected")).toBe("true");
    expect(card("Submit order").getAttribute("aria-selected")).toBe("false");
    expect(card("Request payment").tabIndex).toBe(0);
    expect(document.activeElement).toBe(card("Request payment"));

    fireEvent.keyDown(process(), { key: "ArrowUp" });
    expect(document.activeElement).toBe(card("Submit order"));
  });

  test("the arrows wrap, Home and End jump to either end, Escape clears", () => {
    renderSubmitted();

    fireEvent.keyDown(process(), { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("data-element-id")).toBe("end");
    fireEvent.keyDown(process(), { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("data-element-id")).toBe(
      "a-submit",
    );
    fireEvent.keyDown(process(), { key: "End" });
    expect(document.activeElement?.getAttribute("data-element-id")).toBe("end");
    fireEvent.keyDown(process(), { key: "Home" });
    expect(document.activeElement?.getAttribute("data-element-id")).toBe(
      "a-submit",
    );

    fireEvent.keyDown(process(), { key: "Escape" });
    expect(
      within(process())
        .getAllByRole("option")
        .some((option) => option.getAttribute("aria-selected") === "true"),
    ).toBe(false);
  });
});

describe("filters", () => {
  test("offer every status, the acting participants and no sources", () => {
    renderSubmitted();

    const form = screen.getByRole("search", { name: "Filter elements" });
    const groups = within(form).getAllByRole("group");
    expect(groups.map((group) => group.getAttribute("data-filter"))).toEqual([
      "status",
      "actor",
    ]);
    expect(
      within(screen.getByRole("group", { name: "Actor" }))
        .getAllByRole("checkbox")
        .map((box) => box.parentElement?.textContent),
    ).toEqual(["Customer", "Shop", "Payment provider"]);
  });

  test("a status filter shows only elements with that status", () => {
    renderSubmitted();

    fireEvent.click(screen.getByRole("checkbox", { name: "Blocked" }));

    expect(
      within(process())
        .getAllByRole("option")
        .map((option) => option.getAttribute("data-element-id")),
    ).toEqual(["d-authorised", "a-pack", "a-cancel", "a-authorise", "end"]);
  });

  test("an actor filter combines with a status filter, and clearing shows everything", () => {
    renderSubmitted();

    fireEvent.click(screen.getByRole("checkbox", { name: "Blocked" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Payment provider" }));
    expect(
      within(process())
        .getAllByRole("option")
        .map((option) => option.getAttribute("data-element-id")),
    ).toEqual(["a-authorise"]);

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(within(process()).getAllByRole("option")).toHaveLength(
      order.elements.length,
    );
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: "Blocked" })
        .checked,
    ).toBe(false);
  });

  test("keyboard navigation moves only through the elements a filter shows", () => {
    renderSubmitted();

    fireEvent.click(screen.getByRole("checkbox", { name: "Blocked" }));
    fireEvent.keyDown(process(), { key: "ArrowDown" });
    fireEvent.keyDown(process(), { key: "ArrowDown" });

    expect(document.activeElement?.getAttribute("data-element-id")).toBe(
      "a-pack",
    );
  });
});

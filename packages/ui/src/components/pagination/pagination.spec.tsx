import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Pagination } from "./pagination";

describe("Pagination", () => {
  it("renders nothing for an empty result set", () => {
    const { container } = render(
      <Pagination page={1} pageCount={0} onPageChange={() => undefined} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("clamps the current page and disables the upper bound", () => {
    render(
      <Pagination
        page={99}
        pageCount={4.8}
        onPageChange={() => undefined}
        total={20}
      />,
    );
    expect(screen.getByRole("button", { name: "Page 4" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("button", { name: "End" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Next page" })).toEqual(
      expect.arrayContaining([expect.objectContaining({ disabled: true })]),
    );
    expect(screen.getByTestId("pagination-range")).toHaveTextContent("of 20");
  });

  it("emits exact next, numbered, first, and last pages", async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={5} pageCount={12} onPageChange={onPageChange} />);

    await userEvent.click(
      screen.getAllByRole("button", { name: "Next page" })[0]!,
    );
    await userEvent.click(screen.getByRole("button", { name: "Page 2" }));
    await userEvent.click(screen.getByRole("button", { name: "First" }));
    await userEvent.click(screen.getByRole("button", { name: "End" }));
    expect(onPageChange.mock.calls.map(([page]) => page)).toEqual([
      6, 2, 1, 12,
    ]);
  });

  it("renders the page-size control and exact row range", () => {
    render(
      <Pagination
        page={2}
        pageCount={10}
        pageSize={15}
        total={22}
        onPageChange={() => undefined}
        onPageSizeChange={() => undefined}
        labels={{ rowsPerPage: "Rows" }}
        showFirstLast={false}
      />,
    );
    expect(screen.getByRole("combobox", { name: "Rows" })).toHaveTextContent(
      "15",
    );
    expect(screen.getByTestId("pagination-range")).toHaveTextContent(
      "16-22 of 22",
    );
    expect(
      screen.queryByRole("button", { name: "First" }),
    ).not.toBeInTheDocument();
  });
});

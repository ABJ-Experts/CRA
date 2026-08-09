import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SearchInput } from "./search-input";

describe("SearchInput", () => {
  it("updates, clears, and restores focus when uncontrolled", async () => {
    const onValueChange = vi.fn();
    const onClear = vi.fn();
    render(
      <SearchInput
        aria-label="Products"
        defaultValue="phone"
        clearable
        onValueChange={onValueChange}
        onClear={onClear}
      />,
    );

    const input = screen.getByRole("searchbox", { name: "Products" });
    await userEvent.clear(input);
    await userEvent.type(input, "tablet");
    expect(onValueChange).toHaveBeenLastCalledWith("tablet");
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    expect(input).toHaveFocus();
    expect(onClear).toHaveBeenCalledOnce();
  });

  it("emits a controlled clear request without mutating the supplied value", async () => {
    const onValueChange = vi.fn();
    render(
      <SearchInput
        aria-label="Users"
        value="Ada"
        clearable
        onValueChange={onValueChange}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("searchbox")).toHaveValue("Ada");
    expect(onValueChange).toHaveBeenLastCalledWith("");
  });

  it("forwards object refs and suppresses clear while disabled", () => {
    const ref = createRef<HTMLInputElement>();
    render(
      <SearchInput
        ref={ref}
        aria-label="Disabled search"
        value="fixed"
        clearable
        disabled
        error
        icon={null}
        endAdornment={<span>⌘K</span>}
      />,
    );
    expect(ref.current).toBe(screen.getByRole("searchbox"));
    expect(
      screen.queryByRole("button", { name: "Clear search" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("⌘K")).toBeInTheDocument();
  });
});

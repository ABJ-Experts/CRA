import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TopNav, TopNavTitle } from "./top-nav";

describe("TopNav", () => {
  it("renders default actions with exact callbacks and unread name", async () => {
    const onSearch = vi.fn();
    const onNotifications = vi.fn();
    render(
      <TopNav
        centre={<span>Date range</span>}
        leading={<button type="button">Menu</button>}
        user={{ name: "Ada Lovelace" }}
        notificationCount={3}
        onSearchClick={onSearch}
        onNotificationsClick={onNotifications}
      >
        <TopNavTitle title="Dashboard" subtitle="Welcome back" />
      </TopNav>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Search" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Notifications, 3 unread" }),
    );
    expect(onSearch).toHaveBeenCalledOnce();
    expect(onNotifications).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("img", { name: "Ada Lovelace: online" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Date range")).toBeInTheDocument();
  });

  it("uses replacement actions and omits an absent subtitle", () => {
    render(
      <TopNav actions={<button type="button">Custom</button>}>
        <TopNavTitle title="Account" />
      </TopNav>,
    );
    expect(screen.getByRole("button", { name: "Custom" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Search" }),
    ).not.toBeInTheDocument();
  });
});

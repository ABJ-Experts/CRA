// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
import { ReportsAdministration } from "./reports-administration";

afterEach(cleanup);
it("pauses another owner's schedule using only lifecycle metadata", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const otherOwner = "22222222-2222-4222-8222-222222222222";
  const gateway = {
    administration: vi.fn().mockResolvedValue({
      items: [{ id, ownerUserId: otherOwner, state: "active", version: 3 }],
      nextCursor: null,
    }),
    administrationPause: vi.fn().mockResolvedValue({
      data: { id, ownerUserId: otherOwner, state: "paused", version: 4 },
    }),
  };
  render(
    <ReportsAdministration
      gateway={gateway as never}
      currentUserId="33333333-3333-4333-8333-333333333333"
      recipients={[{ id: otherOwner, displayName: "Another owner" }]}
    />,
  );
  expect(await screen.findByText("Another owner")).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: /view run/i }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: `Pause schedule ${id.slice(0, 8)}` }),
  );
  await waitFor(() =>
    expect(gateway.administrationPause).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ expectedVersion: 3 }),
    ),
  );
  expect(await screen.findByText("paused")).toBeInTheDocument();
});

it("pages metadata and reports version conflicts without exposing the other owner's content", async () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const otherOwner = "22222222-2222-4222-8222-222222222222";
  const gateway = {
    administration: vi
      .fn()
      .mockResolvedValueOnce({
        items: [],
        nextCursor: "22222222-2222-4222-8222-222222222222",
      })
      .mockResolvedValueOnce({
        items: [{ id, ownerUserId: otherOwner, state: "active", version: 3 }],
        nextCursor: null,
      }),
    administrationPause: vi
      .fn()
      .mockRejectedValue(new ApiClientError("api", "Conflict", 409)),
  };
  render(
    <ReportsAdministration
      gateway={gateway as never}
      currentUserId={id}
      recipients={[]}
    />,
  );
  await userEvent.click(
    await screen.findByRole("button", {
      name: "Load more organization schedules",
    }),
  );
  expect(await screen.findByText("Organization member")).toBeInTheDocument();
  expect(gateway.administration).toHaveBeenLastCalledWith({
    cursor: "22222222-2222-4222-8222-222222222222",
  });
  await userEvent.click(
    screen.getByRole("button", { name: `Pause schedule ${id.slice(0, 8)}` }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("changed");
  expect(screen.getByText("active")).toBeInTheDocument();
});

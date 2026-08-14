// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { membersApi } from "../../_features/members/members.api";
import { ApiClientError } from "../../_lib/http/api-client";
import ManagementPage from "./page";

const invalidateQueries = vi.fn(async () => undefined);
const permission = vi.hoisted(() => ({ canEdit: true }));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));
vi.mock("../../_features/members/members.api", () => ({
  membersApi: { changeRole: vi.fn() },
}));
vi.mock("../../_providers/session-provider", () => ({
  useHasPermission: () => permission.canEdit,
}));
vi.mock("@repo/ui/select", () => ({
  Select: ({
    onValueChange,
    children,
  }: {
    onValueChange: (value: string) => void;
    children: ReactNode;
  }) => (
    <button type="button" onClick={() => onValueChange("admin")}>
      {children}
    </button>
  ),
  SelectItem: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../../dashboard/tables/_components/table-page", () => ({
  TablePage: ({
    columns,
    getRowId,
  }: {
    columns: Array<{
      id?: string;
      cell?: (context: {
        row: {
          original: {
            id: string;
            email: string;
            username: null;
            firstName: string;
            lastName: string;
            avatarUrl: null;
            jobTitle: null;
            isActive: boolean;
            role: string;
            joinedAt: string;
          };
        };
      }) => ReactNode;
    }>;
    getRowId: (row: { id: string }) => string;
  }) => {
    const original = {
      id: "a05570d6-aa75-4b6a-9688-b5a82eb3a774",
      email: "ada@example.com",
      username: null,
      firstName: "Ada",
      lastName: "Lovelace",
      avatarUrl: null,
      jobTitle: null,
      isActive: true,
      role: "member",
      joinedAt: "2026-08-09T12:00:00Z",
    } as const;
    return (
      <div data-row-id={getRowId(original)}>
        {columns.map((column) => (
          <div key={column.id}>
            {column.cell?.({
              row: {
                original,
              },
            })}
          </div>
        ))}
      </div>
    );
  },
}));

describe("ManagementPage", () => {
  afterEach(() => {
    cleanup();
    permission.canEdit = true;
    vi.clearAllMocks();
  });

  it("changes a role through membersApi and invalidates cached access", async () => {
    vi.mocked(membersApi.changeRole).mockResolvedValue({ ok: true });
    render(<ManagementPage />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(membersApi.changeRole).toHaveBeenCalledWith(
        "a05570d6-aa75-4b6a-9688-b5a82eb3a774",
        "admin",
      ),
    );
    expect(invalidateQueries).toHaveBeenCalledOnce();
  });

  it("keeps the server wording when a role change is rejected", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    vi.mocked(membersApi.changeRole).mockRejectedValue(
      new ApiClientError("api", "The organization needs an owner.", 409),
    );
    render(<ManagementPage />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("The organization needs an owner."),
    );
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("uses the stable fallback for a transport failure", async () => {
    const alert = vi.spyOn(window, "alert").mockImplementation(() => undefined);
    vi.mocked(membersApi.changeRole).mockRejectedValue(
      new ApiClientError("network", "generic transport copy"),
    );
    render(<ManagementPage />);

    fireEvent.click(screen.getByRole("button"));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith("We could not change that role."),
    );
  });

  it("still renders a role tag when the caller cannot edit", () => {
    permission.canEdit = false;
    render(<ManagementPage />);

    expect(screen.getByText("member")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

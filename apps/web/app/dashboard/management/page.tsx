"use client";

import { Avatar } from "@repo/ui/avatar";
import { Select, SelectItem } from "@repo/ui/select";
import { Tag } from "@repo/ui/tag";
import type { ColumnDef } from "@repo/ui/data-table";
import { BASE_ROLES, type BaseRole } from "@repo/contracts/permissions";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { useHasPermission } from "../../_providers/session-provider";
import { Stacked } from "../tables/_components/cells";
import { TablePage } from "../tables/_components/table-page";

/**
 * User management.
 *
 * Reuses `TablePage` — and therefore `useTableQuery` and `@repo/ui/data-table` —
 * unchanged. That is possible only because `GET /api/v1/users` returns the exact
 * `{ rows, total, page, pageSize, pageCount }` envelope the mock endpoints
 * already returned; the shape was chosen for precisely this reason, and it is
 * why the API has no success envelope wrapping its responses.
 *
 * This route previously fell through to the `[...slug]` "not designed yet"
 * placeholder. Next resolves a specific segment before a catch-all, so adding it
 * changes nothing for the other placeholder routes.
 */

interface MemberRow {
  id: string;
  email: string;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  jobTitle: string | null;
  isActive: boolean;
  role: string;
  joinedAt: string;
}

const ROLE_TONE: Record<string, "purple" | "blue" | "green" | "orange"> = {
  owner: "purple",
  admin: "blue",
  member: "green",
  viewer: "orange",
};

function fullName(row: MemberRow): string {
  const name = [row.firstName, row.lastName].filter(Boolean).join(" ").trim();
  return name || row.username || row.email;
}

export default function ManagementPage() {
  const canEdit = useHasPermission("can_edit_users");
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  /**
   * Changing a role invalidates BOTH the member list and the permission
   * queries: the actor may have just changed their own effective view of the
   * app, and the sidebar reads from the permission cache.
   */
  const changeRole = useCallback(
    async (userId: string, role: BaseRole) => {
      setBusy(userId);
      try {
        const res = await fetch(`/api/v1/users/${userId}/role`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ role }),
        });

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            message?: string;
          };
          // Surfaces the server's own wording — including the last-owner rule,
          // which is enforced by a database trigger and phrased as an action.
          window.alert(body.message ?? "We could not change that role.");
          return;
        }

        await queryClient.invalidateQueries();
      } finally {
        setBusy(null);
      }
    },
    [queryClient],
  );

  const columns = useMemo<ColumnDef<MemberRow, unknown>[]>(
    () => [
      {
        id: "member",
        header: "Member",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar
              size="sm"
              name={fullName(row.original)}
              src={row.original.avatarUrl ?? undefined}
            />
            <Stacked
              value={fullName(row.original)}
              caption={row.original.email}
            />
          </div>
        ),
      },
      {
        id: "jobTitle",
        header: "Job title",
        cell: ({ row }) => (
          <Stacked
            value={row.original.jobTitle ?? "—"}
            caption={row.original.username ?? ""}
          />
        ),
      },
      {
        id: "role",
        header: "Role",
        cell: ({ row }) =>
          canEdit ? (
            <Select
              value={row.original.role}
              onValueChange={(value) =>
                void changeRole(row.original.id, value as BaseRole)
              }
              disabled={busy === row.original.id}
            >
              {BASE_ROLES.map((r) => (
                <SelectItem key={r} value={r}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </SelectItem>
              ))}
            </Select>
          ) : (
            <Tag tone={ROLE_TONE[row.original.role] ?? "blue"} variant="cool">
              {row.original.role}
            </Tag>
          ),
      },
      {
        id: "status",
        header: "Status",
        cell: ({ row }) => (
          <Tag variant="dot" tone={row.original.isActive ? "green" : "red"}>
            {row.original.isActive ? "Active" : "Deactivated"}
          </Tag>
        ),
      },
    ],
    [canEdit, busy, changeRole],
  );

  return (
    <TablePage<MemberRow>
      endpoint="/api/v1/users"
      variant="basic"
      ariaLabel="Organization members"
      searchPlaceholder="Search members"
      columns={columns}
      getRowId={(row) => row.id}
    />
  );
}

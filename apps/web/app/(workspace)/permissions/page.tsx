"use client";

import { Button } from "@repo/ui/button";
import { Checkbox } from "@repo/ui/checkbox";
import {
  BASE_ROLES,
  DEFAULT_PERMISSIONS_BY_ROLE,
  PERMISSION_MATRIX,
  PERMISSION_MODULES,
  hasPermission,
  type BaseRole,
  type PermissionKey,
  type PermissionSet,
} from "@repo/contracts/permissions";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fragment, useState } from "react";

import { SectionCard } from "../../dashboard/_components/dashboard-chrome";
import { rolesApi, rolesQueryKeys } from "../../_features/roles/roles.api";
import { ApiClientError } from "../../_lib/http/api-client";
import { useHasPermission } from "../../_providers/session-provider";

/**
 * The base-role permission matrix.
 *
 * Shows the DEFAULT for each base role, with the organization's overrides laid
 * on top. Ticking a box writes an override; the effective value the API
 * enforces is `default, then override` — and the override is applied LAST in
 * `resolveEffectivePermissions`, so a revocation here cannot be undone by
 * assigning someone a custom role. That ordering is the fix for a real
 * escalation hole in the reference.
 *
 * Gated on `can_edit_organization` rather than `can_edit_roles`: this changes
 * what EVERY member of a base role can do, which in the default presets only an
 * owner may do.
 */

function effectiveValue(
  role: BaseRole,
  key: PermissionKey,
  overrides: PermissionSet,
): boolean {
  const override = overrides[key];
  if (override !== undefined) return override;
  return hasPermission(DEFAULT_PERMISSIONS_BY_ROLE[role], key);
}

export default function PermissionsMatrixPage() {
  const canEdit = useHasPermission("can_edit_organization");
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState<BaseRole | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: rolesQueryKeys.overrides,
    retry: false,
    queryFn: ({ signal }) => rolesApi.getOverrides(signal),
  });

  async function toggle(role: BaseRole, key: PermissionKey, next: boolean) {
    setSaving(role);
    try {
      const current = data?.overrides[role] ?? {};
      /*
       * The whole set for that role is sent, not a delta: the endpoint upserts a
       * single jsonb column, so a partial body would silently drop every other
       * override the organization had configured.
       */
      const permissions = { ...current, [key]: next };

      await rolesApi.setOverride(role, permissions);

      // Invalidate broadly: an override changes the caller's own effective
      // permissions and therefore the sidebar.
      await queryClient.invalidateQueries();
    } catch (error) {
      window.alert(
        error instanceof ApiClientError && error.kind === "api"
          ? error.message
          : "We could not save that change.",
      );
    } finally {
      setSaving(null);
    }
  }

  if (isError) {
    return (
      <div className="px-6 pb-8 lg:px-[30px]">
        <SectionCard>
          <div role="alert" className="flex flex-col items-start gap-3 p-6">
            <p className="text-subhead-regular text-fg-muted">
              We could not load permissions.
            </p>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        </SectionCard>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 px-6 pb-8 lg:px-[30px]">
      <div>
        <h1 className="text-h5 text-fg">Permissions</h1>
        <p className="text-subhead-regular text-fg-muted">
          What each base role can do in this organization. Changes here apply to
          every member holding that role.
        </p>
      </div>

      {isLoading ? (
        <SectionCard>
          <p className="p-6 text-subhead-regular text-fg-muted">Loading…</p>
        </SectionCard>
      ) : (
        <SectionCard>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse">
              <caption className="sr-only">
                Permissions by base role for this organization
              </caption>
              <thead>
                <tr className="border-b border-border">
                  <th
                    scope="col"
                    className="p-3 text-left text-caption-1-semibold text-fg-subtle"
                  >
                    Permission
                  </th>
                  {BASE_ROLES.map((role) => (
                    <th
                      key={role}
                      scope="col"
                      className="p-3 text-center text-caption-1-semibold text-fg-subtle capitalize"
                    >
                      {role}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERMISSION_MODULES.map((module) => (
                  <Fragment key={module}>
                    <tr className="bg-surface-muted">
                      <th
                        scope="colgroup"
                        colSpan={BASE_ROLES.length + 1}
                        className="p-2 text-left text-caption-2-semibold text-fg-subtle capitalize"
                      >
                        {module}
                      </th>
                    </tr>
                    {(PERMISSION_MATRIX[module] as readonly string[]).map(
                      (action) => {
                        const key = `can_${action}_${module}` as PermissionKey;
                        return (
                          <tr key={key} className="border-b border-border">
                            <td className="p-3 text-subhead-regular text-fg">
                              {action}
                            </td>
                            {BASE_ROLES.map((role) => (
                              <td key={role} className="p-3 text-center">
                                <Checkbox
                                  checked={effectiveValue(
                                    role,
                                    key,
                                    data?.overrides[role] ?? {},
                                  )}
                                  disabled={!canEdit || saving === role}
                                  aria-label={`${action} ${module} for ${role}`}
                                  onCheckedChange={(next) =>
                                    void toggle(role, key, next === true)
                                  }
                                />
                              </td>
                            ))}
                          </tr>
                        );
                      },
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

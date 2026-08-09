"use client";

import { Button } from "@repo/ui/button";
import { Card, CardBody, CardHeader, CardTitle } from "@repo/ui/card";
import { Tag } from "@repo/ui/tag";
import { useQuery } from "@tanstack/react-query";

import {
  SectionCard,
  Stagger,
  StaggerItem,
} from "../_components/dashboard-chrome";
import { rolesApi, rolesQueryKeys } from "../../_features/roles/roles.api";
import { useHasPermission } from "../../_providers/session-provider";

/**
 * Custom roles.
 *
 * A custom role may only ADD permissions on top of a member's base role — it can
 * never take one away. That asymmetry is enforced in `@repo/contracts` and is
 * the reason `base_role` is shown here as a muted label rather than as a
 * setting: it groups and colours the role in this list, and grants nothing.
 * The reference treats it as a grant, which is how a role called "Report
 * Reader" ends up conferring full ownership.
 */

function grantedCount(permissions: Readonly<Record<string, boolean>>): number {
  return Object.values(permissions).filter((v) => v === true).length;
}

export default function RolesPage() {
  const canCreate = useHasPermission("can_create_roles");

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: rolesQueryKeys.list,
    retry: false,
    queryFn: ({ signal }) => rolesApi.list(signal),
  });

  return (
    <div className="flex flex-col gap-6 px-6 pb-8 lg:px-[30px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h5 text-fg">Roles</h1>
          <p className="text-subhead-regular text-fg-muted">
            Named bundles of extra permissions. A role can only add to what a
            member&rsquo;s base role already allows.
          </p>
        </div>
        {canCreate ? <Button>New role</Button> : null}
      </div>

      {isError ? (
        <SectionCard>
          <div role="alert" className="flex flex-col items-start gap-3 p-6">
            <p className="text-subhead-regular text-fg-muted">
              We could not load roles.
            </p>
            <Button variant="outline" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        </SectionCard>
      ) : null}

      {isLoading ? (
        <SectionCard>
          <p className="p-6 text-subhead-regular text-fg-muted">
            Loading roles…
          </p>
        </SectionCard>
      ) : null}

      <Stagger className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {(data?.rows ?? []).map((role) => (
          <StaggerItem key={role.id}>
            <Card variant="outlined">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: role.color }}
                  />
                  <CardTitle>{role.name}</CardTitle>
                </div>
              </CardHeader>
              <CardBody>
                <p className="text-subhead-regular text-fg-muted">
                  {role.description ?? "No description."}
                </p>
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <Tag variant="cool" tone="blue">
                    {grantedCount(role.permissions)} permissions
                  </Tag>
                  <Tag variant="cool" tone="green">
                    {role.memberCount} member{role.memberCount === 1 ? "" : "s"}
                  </Tag>
                  {role.isSystem ? (
                    <Tag variant="cool" tone="purple">
                      System
                    </Tag>
                  ) : null}
                  {!role.isActive ? (
                    <Tag variant="dot" tone="red">
                      Inactive
                    </Tag>
                  ) : null}
                </div>
                {/* Label, not a grant — see the note at the top of this file. */}
                <p className="mt-3 text-caption-1-regular text-fg-subtle">
                  Grouped under {role.baseRole}
                </p>
              </CardBody>
            </Card>
          </StaggerItem>
        ))}
      </Stagger>

      {!isLoading && !isError && (data?.rows ?? []).length === 0 ? (
        <SectionCard>
          <p className="p-6 text-subhead-regular text-fg-muted">
            No custom roles yet. Base roles alone decide what everyone can do.
          </p>
        </SectionCard>
      ) : null}
    </div>
  );
}

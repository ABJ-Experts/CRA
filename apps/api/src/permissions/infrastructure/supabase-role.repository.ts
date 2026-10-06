import { Injectable, Logger } from "@nestjs/common";
import {
  isBaseRole,
  sanitizePermissions,
  type BaseRole,
  type PermissionSet,
} from "@repo/contracts/permissions";
import { customRoleSchema, type CustomRole } from "@repo/contracts/roles";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import type { Json } from "../../supabase/database.types";
import {
  RoleRepositoryError,
  type AuditMutationContext,
  type CreateRoleRecord,
  type CustomRoleIdentity,
  type RoleRepository,
  type UpdateRoleRecord,
} from "../application/role-repository.port";

const ROLE_SELECT =
  "id, name, description, color, base_role, permissions, is_system, is_active, user_role_assignments(count)";
const mutationResultSchema = z.object({
  status: z.enum([
    "updated",
    "unchanged",
    "replayed",
    "not_found",
    "system",
    "conflict",
  ]),
  id: z.string().uuid().nullish(),
});

@Injectable()
export class SupabaseRoleRepository implements RoleRepository {
  private readonly logger = new Logger(SupabaseRoleRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string): Promise<readonly CustomRole[]> {
    const { data, error } = await this.supabase
      .admin()
      .from("custom_roles")
      .select(ROLE_SELECT)
      .eq("organization_id", orgId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });
    if (error) this.fail(error.message);

    return (data ?? []).map((row) => this.toRole(row));
  }

  async create(
    orgId: string,
    input: CreateRoleRecord,
    actorId?: string,
    context?: AuditMutationContext,
  ): Promise<{ id: string }> {
    const result = await this.mutateRole(
      orgId,
      actorId,
      "create",
      null,
      {
        name: input.name,
        description: input.description,
        color: input.color,
        baseRole: input.baseRole,
        permissions: input.permissions,
      },
      context,
    );
    if (!result.id) this.fail("create returned no role id");
    return Object.freeze({ id: result.id });
  }

  async find(
    orgId: string,
    roleId: string,
  ): Promise<CustomRoleIdentity | null> {
    const { data, error } = await this.supabase
      .admin()
      .from("custom_roles")
      .select("id, is_system, version")
      .eq("id", roleId)
      .eq("organization_id", orgId)
      .eq("is_deleted", false)
      .maybeSingle();
    if (error) this.fail(error.message);
    if (!data) return null;
    return Object.freeze({
      id: data.id,
      isSystem: data.is_system,
      version: data.version,
    });
  }

  async update(
    orgId: string,
    roleId: string,
    patch: UpdateRoleRecord,
    actorId?: string,
    context?: AuditMutationContext,
    expectedVersion?: number,
  ): Promise<void> {
    await this.mutateRole(
      orgId,
      actorId,
      "update",
      roleId,
      {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.baseRole !== undefined ? { baseRole: patch.baseRole } : {}),
        ...(patch.permissions !== undefined
          ? { permissions: patch.permissions }
          : {}),
        ...(patch.isActive !== undefined ? { isActive: patch.isActive } : {}),
      },
      context,
      expectedVersion ?? null,
    );
  }

  async softDelete(
    orgId: string,
    roleId: string,
    actorId: string,
    context?: AuditMutationContext,
    expectedVersion?: number,
  ): Promise<void> {
    await this.mutateRole(
      orgId,
      actorId,
      "delete",
      roleId,
      {},
      context,
      expectedVersion ?? null,
    );
  }

  async overrides(
    orgId: string,
  ): Promise<Readonly<Record<string, PermissionSet>>> {
    const { data, error } = await this.supabase
      .admin()
      .from("base_role_permission_overrides")
      .select("base_role, permissions")
      .eq("organization_id", orgId);
    if (error) this.fail(error.message);

    return Object.fromEntries(
      (data ?? []).map((row) => [
        this.baseRole(row.base_role),
        sanitizePermissions(row.permissions),
      ]),
    );
  }

  async setOverride(
    orgId: string,
    baseRole: BaseRole,
    permissions: PermissionSet,
    actorId?: string,
    context?: AuditMutationContext,
  ): Promise<void> {
    await this.mutateRole(
      orgId,
      actorId,
      "override",
      null,
      { baseRole, permissions },
      context,
    );
  }

  private async mutateRole(
    orgId: string,
    actorId: string | undefined,
    operation: "create" | "update" | "delete" | "override",
    roleId: string | null,
    payload: Record<string, unknown>,
    context: AuditMutationContext | undefined,
    expectedVersion: number | null = null,
  ): Promise<z.output<typeof mutationResultSchema>> {
    if (!actorId || !context) throw new RoleRepositoryError("unavailable");
    const { data, error } = await this.supabase
      .admin()
      .rpc("m13_01_mutate_role_atomic", {
        p_organization_id: orgId,
        p_actor_user_id: actorId,
        p_operation: operation,
        // Generated RPC types omit SQL argument nullability; PostgREST accepts null.
        p_role_id: roleId as string,
        p_payload: payload as Json,
        p_expected_version: expectedVersion as number,
        p_event_key: context.eventKey,
        p_correlation_id: context.correlationId,
        p_source_ip: context.sourceIp,
      });
    if (error?.message.includes("duplicate key"))
      throw new RoleRepositoryError("role_name_taken");
    if (error) this.fail(error.message);
    const parsed = mutationResultSchema.safeParse(data);
    if (!parsed.success) this.fail("invalid audited mutation result");
    if (parsed.data.status === "not_found")
      throw new RoleRepositoryError("role_not_found");
    if (parsed.data.status === "system")
      throw new RoleRepositoryError("role_is_system");
    if (parsed.data.status === "conflict")
      throw new RoleRepositoryError("conflict");
    return parsed.data;
  }

  private fail(message: string): never {
    this.logger.error(`Role persistence failed: ${message}`);
    throw new RoleRepositoryError("unavailable");
  }

  private baseRole(value: string): BaseRole {
    if (isBaseRole(value)) return value;
    this.logger.error("Role query returned an invalid base role");
    throw new RoleRepositoryError("unavailable");
  }

  private toRole(row: {
    id: string;
    name: string;
    description: string | null;
    color: string;
    base_role: string;
    permissions: unknown;
    is_system: boolean;
    is_active: boolean;
    user_role_assignments: unknown;
  }): CustomRole {
    const parsed = customRoleSchema.safeParse({
      id: row.id,
      name: row.name,
      description: row.description,
      color: row.color,
      baseRole: this.baseRole(row.base_role),
      permissions: sanitizePermissions(row.permissions),
      isSystem: row.is_system,
      isActive: row.is_active,
      memberCount:
        (row.user_role_assignments as { count: number }[] | null)?.[0]?.count ??
        0,
    });
    if (parsed.success) return parsed.data;
    this.logger.error("Role query returned a malformed role record");
    throw new RoleRepositoryError("unavailable");
  }
}

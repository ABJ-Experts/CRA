import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { BaseRole, PermissionSet } from "@repo/contracts/permissions";
import { sanitizePermissions } from "@repo/contracts/permissions";

import { AuditService } from "../audit/audit.service";
import { SupabaseService } from "../supabase/supabase.service";

export interface CustomRoleRow {
  id: string;
  name: string;
  description: string | null;
  color: string;
  baseRole: string;
  permissions: PermissionSet;
  isSystem: boolean;
  isActive: boolean;
  memberCount: number;
}

/**
 * Custom roles and the organization's base-role overrides.
 *
 * Everything written here goes through `sanitizePermissions` first, so a client
 * cannot persist a key that does not exist. Without that, a typo'd or renamed
 * key would sit in `jsonb` looking like a grant and quietly do nothing — which
 * is worse than an error, because the admin screen would show it as configured.
 */
@Injectable()
export class CustomRolesService {
  private readonly logger = new Logger(CustomRolesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
  ) {}

  async list(orgId: string): Promise<CustomRoleRow[]> {
    const { data, error } = await this.supabase
      .admin()
      .from("custom_roles")
      .select(
        "id, name, description, color, base_role, permissions, is_system, is_active, user_role_assignments(count)",
      )
      .eq("organization_id", orgId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: true });

    if (error) {
      this.logger.error(`Role list failed: ${error.message}`);
      throw new BadRequestException({
        message: "We could not load those roles.",
        code: "role_list_failed",
      });
    }

    return (data ?? []).map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      color: r.color,
      baseRole: r.base_role,
      permissions: sanitizePermissions(r.permissions),
      isSystem: r.is_system,
      isActive: r.is_active,
      memberCount:
        (r.user_role_assignments as unknown as { count: number }[] | null)?.[0]
          ?.count ?? 0,
    }));
  }

  async create(
    orgId: string,
    actor: { id: string; email: string },
    input: {
      name: string;
      description?: string;
      color?: string;
      baseRole: BaseRole;
      permissions: unknown;
    },
  ): Promise<{ id: string }> {
    const { data, error } = await this.supabase
      .admin()
      .from("custom_roles")
      .insert({
        organization_id: orgId,
        name: input.name,
        description: input.description ?? null,
        color: input.color ?? "#6B7280",
        base_role: input.baseRole,
        permissions: sanitizePermissions(input.permissions),
      })
      .select("id")
      .single();

    if (error) {
      // The partial unique index excludes soft-deleted rows, so this really does
      // mean a live role already owns the name.
      if (error.message.includes("duplicate key")) {
        throw new ConflictException({
          message: "A role with that name already exists.",
          code: "role_name_taken",
          fieldErrors: { name: "That name is already in use." },
        });
      }
      this.logger.error(`Role create failed: ${error.message}`);
      throw new BadRequestException({
        message: "We could not create that role.",
        code: "role_create_failed",
      });
    }

    this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      actorEmail: actor.email,
      action: "role.created",
      entityType: "custom_role",
      entityId: data.id,
    });

    return { id: data.id };
  }

  async update(
    orgId: string,
    actor: { id: string; email: string },
    roleId: string,
    patch: {
      name?: string;
      description?: string;
      color?: string;
      baseRole?: BaseRole;
      permissions?: unknown;
      isActive?: boolean;
    },
  ): Promise<void> {
    const existing = await this.byId(orgId, roleId);

    if (existing.is_system) {
      // System roles are seeded and referenced by name; letting them be edited
      // makes the seed non-idempotent and the naming meaningless.
      throw new ConflictException({
        message: "System roles cannot be edited.",
        code: "role_is_system",
      });
    }

    const { error } = await this.supabase
      .admin()
      .from("custom_roles")
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined
          ? { description: patch.description }
          : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        ...(patch.baseRole !== undefined ? { base_role: patch.baseRole } : {}),
        ...(patch.permissions !== undefined
          ? { permissions: sanitizePermissions(patch.permissions) }
          : {}),
        ...(patch.isActive !== undefined ? { is_active: patch.isActive } : {}),
      })
      .eq("id", roleId)
      .eq("organization_id", orgId);

    if (error) {
      this.logger.error(`Role update failed: ${error.message}`);
      throw new BadRequestException({
        message: "We could not save that role.",
        code: "role_update_failed",
      });
    }

    this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      actorEmail: actor.email,
      action: "role.updated",
      entityType: "custom_role",
      entityId: roleId,
    });
  }

  /**
   * Soft delete.
   *
   * The row survives so `user_role_assignments` keeps its foreign key and the
   * audit trail still resolves the name. The partial unique index excludes
   * deleted rows, so the name becomes reusable immediately — the reference's
   * plain unique constraint left a trashed role squatting its own name forever.
   */
  async remove(
    orgId: string,
    actor: { id: string; email: string },
    roleId: string,
  ): Promise<void> {
    const existing = await this.byId(orgId, roleId);

    if (existing.is_system) {
      throw new ConflictException({
        message: "System roles cannot be deleted.",
        code: "role_is_system",
      });
    }

    const { error } = await this.supabase
      .admin()
      .from("custom_roles")
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: actor.id,
        is_active: false,
      })
      .eq("id", roleId)
      .eq("organization_id", orgId);

    if (error) {
      throw new BadRequestException({
        message: "We could not delete that role.",
        code: "role_delete_failed",
      });
    }

    this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      actorEmail: actor.email,
      action: "role.deleted",
      entityType: "custom_role",
      entityId: roleId,
    });
  }

  // -------------------------------------------------------------------------
  // Base-role overrides — the permission matrix screen.
  // -------------------------------------------------------------------------

  async overrides(orgId: string): Promise<Record<string, PermissionSet>> {
    const { data, error } = await this.supabase
      .admin()
      .from("base_role_permission_overrides")
      .select("base_role, permissions")
      .eq("organization_id", orgId);

    if (error) {
      this.logger.error(`Override read failed: ${error.message}`);
      return {};
    }

    const out: Record<string, PermissionSet> = {};
    for (const row of data ?? []) {
      out[row.base_role] = sanitizePermissions(row.permissions);
    }
    return out;
  }

  async setOverride(
    orgId: string,
    actor: { id: string; email: string },
    baseRole: BaseRole,
    permissions: unknown,
  ): Promise<void> {
    const clean = sanitizePermissions(permissions);

    const { error } = await this.supabase
      .admin()
      .from("base_role_permission_overrides")
      .upsert(
        { organization_id: orgId, base_role: baseRole, permissions: clean },
        // Legal only because of the UNIQUE (organization_id, base_role)
        // constraint added in the RBAC migration.
        { onConflict: "organization_id,base_role" },
      );

    if (error) {
      this.logger.error(`Override write failed: ${error.message}`);
      throw new BadRequestException({
        message: "We could not save those permissions.",
        code: "override_failed",
      });
    }

    this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      actorEmail: actor.email,
      action: "permissions.override_updated",
      entityType: "base_role",
      entityId: baseRole,
    });
  }

  private async byId(
    orgId: string,
    roleId: string,
  ): Promise<{ id: string; is_system: boolean }> {
    const { data } = await this.supabase
      .admin()
      .from("custom_roles")
      .select("id, is_system")
      .eq("id", roleId)
      .eq("organization_id", orgId)
      .eq("is_deleted", false)
      .maybeSingle();

    if (!data) {
      throw new NotFoundException({
        message: "That role no longer exists.",
        code: "role_not_found",
      });
    }
    return data;
  }
}

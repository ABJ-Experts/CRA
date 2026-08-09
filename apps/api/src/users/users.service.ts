import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import type { BaseRole } from "@repo/contracts/permissions";
import type { PageParams, Paged } from "@repo/contracts/pagination";
import { paged, resolvePage } from "@repo/contracts/pagination";

import { AuditService } from "../audit/audit.service";
import { SupabaseService } from "../supabase/supabase.service";

export interface MemberRow {
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
  roles: { id: string; name: string; color: string }[];
}

/**
 * Members of an organization.
 *
 * EVERY method takes `orgId` as its FIRST argument, without exception.
 *
 * That is not a style preference. The API talks to Postgres as `service_role`,
 * which bypasses RLS entirely, so a forgotten `.eq("organization_id", …)` is a
 * silent cross-tenant read that no policy will catch. Making the scope a
 * required leading parameter means it cannot be omitted by accident — you have
 * to actively pass the wrong one.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Paginated member list.
   *
   * Returns the exact `{ rows, total, page, pageSize, pageCount }` envelope
   * `use-table-query.ts` and `@repo/ui/data-table` already consume, so the
   * management screen reuses the existing table stack with no adapter.
   */
  async listMembers(
    orgId: string,
    params: PageParams,
  ): Promise<Paged<MemberRow>> {
    const { from, to } = resolvePage(
      await this.countMembers(orgId, params),
      params,
    );

    let query = this.supabase
      .admin()
      .from("organization_members")
      .select(
        "role, created_at, users!inner(id, email, username, first_name, last_name, avatar_url, job_title, is_active)",
        { count: "exact" },
      )
      .eq("organization_id", orgId);

    if (params.q) {
      // Searching the joined table needs the embedded-column syntax; a plain
      // .or() here would filter organization_members and silently match nothing.
      query = query.or(
        `email.ilike.%${params.q}%,first_name.ilike.%${params.q}%,last_name.ilike.%${params.q}%,username.ilike.%${params.q}%`,
        { referencedTable: "users" },
      );
    }

    const { data, count, error } = await query
      .order("created_at", { ascending: params.order === "asc" })
      .range(from, to);

    if (error) {
      this.logger.error(`Member list failed: ${error.message}`);
      throw new BadRequestException({
        message: "We could not load those members.",
        code: "member_list_failed",
      });
    }

    const rows = (data ?? [])
      .filter((r) => r.users !== null)
      .map((r) => ({
        id: r.users.id,
        email: r.users.email,
        username: r.users.username,
        firstName: r.users.first_name,
        lastName: r.users.last_name,
        avatarUrl: r.users.avatar_url,
        jobTitle: r.users.job_title,
        isActive: r.users.is_active,
        role: r.role,
        joinedAt: r.created_at,
        roles: [] as { id: string; name: string; color: string }[],
      }));

    return paged(rows, count ?? rows.length, params);
  }

  private async countMembers(
    orgId: string,
    params: PageParams,
  ): Promise<number> {
    let query = this.supabase
      .admin()
      .from("organization_members")
      .select("id, users!inner(id)", { count: "exact", head: true })
      .eq("organization_id", orgId);

    if (params.q) {
      query = query.or(
        `email.ilike.%${params.q}%,first_name.ilike.%${params.q}%,last_name.ilike.%${params.q}%,username.ilike.%${params.q}%`,
        { referencedTable: "users" },
      );
    }

    const { count } = await query;
    return count ?? 0;
  }

  /**
   * Change a member's base role.
   *
   * The last-owner rule is enforced by a database trigger, not here — service
   * code can be bypassed by a script or a direct query, and an organization with
   * no owner has no UI path back. This method's job is to turn that trigger's
   * error into a sentence a person can act on.
   */
  async changeRole(
    orgId: string,
    actor: { id: string; email: string },
    targetUserId: string,
    role: BaseRole,
  ): Promise<void> {
    if (actor.id === targetUserId) {
      /*
       * Self-demotion is blocked at the service layer even though the trigger
       * would catch the last-owner case. An admin demoting themselves by
       * accident is a support ticket; making it deliberate (ask someone else)
       * costs nothing.
       */
      throw new ConflictException({
        message: "You cannot change your own role.",
        code: "cannot_change_own_role",
      });
    }

    const { data: existing } = await this.supabase
      .admin()
      .from("organization_members")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!existing) {
      throw new NotFoundException({
        message: "That person is not a member of this organization.",
        code: "member_not_found",
      });
    }

    const { error } = await this.supabase
      .admin()
      .from("organization_members")
      .update({ role })
      .eq("organization_id", orgId)
      .eq("user_id", targetUserId);

    if (error) {
      throw this.translate(error.message, "We could not change that role.");
    }

    this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      actorEmail: actor.email,
      action: "member.role_changed",
      entityType: "user",
      entityId: targetUserId,
      changes: { from: existing.role, to: role },
    });
  }

  /** Remove someone from the organization. Their account survives. */
  async removeMember(
    orgId: string,
    actor: { id: string; email: string },
    targetUserId: string,
  ): Promise<void> {
    if (actor.id === targetUserId) {
      throw new ConflictException({
        message: "You cannot remove yourself from the organization.",
        code: "cannot_remove_self",
      });
    }

    const { error } = await this.supabase
      .admin()
      .from("organization_members")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", targetUserId);

    if (error) {
      throw this.translate(error.message, "We could not remove that member.");
    }

    this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      actorEmail: actor.email,
      action: "member.removed",
      entityType: "user",
      entityId: targetUserId,
    });
  }

  /**
   * Deactivate or reactivate an account.
   *
   * Deactivation bumps `session_epoch_at` through a database trigger, so every
   * live token for that user stops working immediately rather than at the end
   * of its hour.
   */
  async setActive(
    orgId: string,
    actor: { id: string; email: string },
    targetUserId: string,
    isActive: boolean,
  ): Promise<void> {
    if (actor.id === targetUserId && !isActive) {
      throw new ConflictException({
        message: "You cannot deactivate your own account.",
        code: "cannot_deactivate_self",
      });
    }

    // Scoped through the membership table: without this check an admin of one
    // organization could deactivate any user id they could guess.
    const { data: membership } = await this.supabase
      .admin()
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (!membership) {
      throw new NotFoundException({
        message: "That person is not a member of this organization.",
        code: "member_not_found",
      });
    }

    const { error } = await this.supabase
      .admin()
      .from("users")
      .update({ is_active: isActive })
      .eq("id", targetUserId);

    if (error) {
      throw this.translate(error.message, "We could not update that account.");
    }

    this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      actorEmail: actor.email,
      action: isActive ? "member.reactivated" : "member.deactivated",
      entityType: "user",
      entityId: targetUserId,
    });
  }

  /** Update your own profile. */
  async updateProfile(
    userId: string,
    patch: {
      firstName?: string;
      lastName?: string;
      jobTitle?: string;
      language?: string;
    },
  ): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .from("users")
      .update({
        ...(patch.firstName !== undefined
          ? { first_name: patch.firstName }
          : {}),
        ...(patch.lastName !== undefined ? { last_name: patch.lastName } : {}),
        ...(patch.jobTitle !== undefined ? { job_title: patch.jobTitle } : {}),
        ...(patch.language !== undefined ? { language: patch.language } : {}),
      })
      .eq("id", userId);

    if (error) {
      throw this.translate(error.message, "We could not save those changes.");
    }
  }

  /**
   * Turn a Postgres error into something a person can act on.
   *
   * The last-owner trigger raises a `check_violation` with a message naming the
   * organization id — accurate, and useless in a toast. The API's job is to say
   * what to do about it.
   */
  private translate(message: string, fallback: string): BadRequestException {
    if (message.includes("must retain at least one owner")) {
      return new ConflictException({
        message:
          "This organization needs at least one owner. Promote someone else first.",
        code: "last_owner",
      });
    }
    this.logger.error(message);
    return new BadRequestException({
      message: fallback,
      code: "update_failed",
    });
  }
}

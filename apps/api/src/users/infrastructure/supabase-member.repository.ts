import { Injectable, Logger } from "@nestjs/common";
import {
  paged,
  resolvePage,
  type PageParams,
  type Paged,
} from "@repo/contracts/pagination";
import { BASE_ROLES, type BaseRole } from "@repo/contracts/permissions";
import type { Member } from "@repo/contracts/users";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  MemberRepositoryError,
  type AuditMutationContext,
  type MemberRepository,
  type ProfilePatch,
} from "../application/member-repository.port";

const MEMBER_SELECT =
  "role, created_at, users!inner(id, email, username, first_name, last_name, avatar_url, job_title, is_active)";
const MEMBER_SEARCH_COLUMNS = [
  "email",
  "first_name",
  "last_name",
  "username",
] as const;
const mutationResultSchema = z.object({
  status: z.enum(["updated", "unchanged", "replayed", "not_found", "conflict"]),
});

@Injectable()
export class SupabaseMemberRepository implements MemberRepository {
  private readonly logger = new Logger(SupabaseMemberRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string, params: PageParams): Promise<Paged<Member>> {
    let countQuery = this.supabase
      .admin()
      .from("organization_members")
      .select("id, users!inner(id)", { count: "exact", head: true })
      .eq("organization_id", orgId);
    const search = this.searchExpression(params.q);
    if (search) {
      countQuery = countQuery.or(search, { referencedTable: "users" });
    }
    const countResult = await countQuery;
    if (countResult.error) this.fail(countResult.error.message);

    const total = countResult.count ?? 0;
    const { from, to } = resolvePage(total, params);
    let rowsQuery = this.supabase
      .admin()
      .from("organization_members")
      .select(MEMBER_SELECT, { count: "exact" })
      .eq("organization_id", orgId);
    if (search) {
      rowsQuery = rowsQuery.or(search, { referencedTable: "users" });
    }
    const result = await rowsQuery
      .order("created_at", { ascending: params.order === "asc" })
      .range(from, to);
    if (result.error) this.fail(result.error.message);

    const rows = (result.data ?? [])
      .filter((row) => row.users !== null)
      .map((row) => this.toMember(row));
    return paged(rows, result.count ?? total, params);
  }

  async findMembership(
    orgId: string,
    userId: string,
  ): Promise<{ role: BaseRole } | null> {
    const { data, error } = await this.supabase
      .admin()
      .from("organization_members")
      .select("role")
      .eq("organization_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();
    if (error) this.fail(error.message);
    if (!data) return null;
    return Object.freeze({ role: this.baseRole(data.role) });
  }

  async changeRole(
    orgId: string,
    userId: string,
    role: BaseRole,
    actorId?: string,
    context?: AuditMutationContext,
    expectedRole?: BaseRole,
  ): Promise<void> {
    await this.mutateMember(
      orgId,
      actorId,
      userId,
      "role",
      { role },
      expectedRole ?? null,
      context,
    );
  }

  async remove(
    orgId: string,
    userId: string,
    actorId?: string,
    context?: AuditMutationContext,
  ): Promise<void> {
    await this.mutateMember(
      orgId,
      actorId,
      userId,
      "remove",
      {},
      null,
      context,
    );
  }

  async setActive(
    orgId: string,
    userId: string,
    isActive: boolean,
    actorId?: string,
    context?: AuditMutationContext,
  ): Promise<void> {
    await this.mutateMember(
      orgId,
      actorId,
      userId,
      "active",
      { isActive },
      null,
      context,
    );
  }

  async updateOwnProfile(
    orgId: string | null,
    userId: string,
    patch: ProfilePatch,
    context?: AuditMutationContext,
  ): Promise<void> {
    const audit = this.requiredContext(userId, context);
    const { data, error } = await this.supabase
      .admin()
      .rpc("m13_01_update_profile_atomic", {
        // Generated RPC types omit SQL argument nullability; security scope uses null.
        p_organization_id: orgId as string,
        p_actor_user_id: userId,
        p_patch: {
          ...(patch.firstName !== undefined
            ? { first_name: patch.firstName }
            : {}),
          ...(patch.lastName !== undefined
            ? { last_name: patch.lastName }
            : {}),
          ...(patch.jobTitle !== undefined
            ? { job_title: patch.jobTitle }
            : {}),
          ...(patch.language !== undefined ? { language: patch.language } : {}),
        },
        p_event_key: audit.eventKey,
        p_correlation_id: audit.correlationId,
        p_source_ip: audit.sourceIp,
      });
    if (error) this.fail(error.message);
    this.assertMutationResult(data);
  }

  private async mutateMember(
    orgId: string,
    actorId: string | undefined,
    userId: string,
    operation: "role" | "remove" | "active",
    payload: Record<string, string | boolean>,
    expectedRole: BaseRole | null,
    context: AuditMutationContext | undefined,
  ): Promise<void> {
    const audit = this.requiredContext(actorId, context);
    const { data, error } = await this.supabase
      .admin()
      .rpc("m13_01_mutate_member_atomic", {
        p_organization_id: orgId,
        p_actor_user_id: actorId!,
        p_target_user_id: userId,
        p_operation: operation,
        p_payload: payload,
        p_expected_role: expectedRole as string,
        p_event_key: audit.eventKey,
        p_correlation_id: audit.correlationId,
        p_source_ip: audit.sourceIp,
      });
    if (error) this.fail(error.message);
    this.assertMutationResult(data);
  }

  private requiredContext(
    actorId: string | undefined,
    context: AuditMutationContext | undefined,
  ): AuditMutationContext {
    if (!actorId || !context) throw new MemberRepositoryError("unavailable");
    return context;
  }

  private assertMutationResult(value: unknown): void {
    const parsed = mutationResultSchema.safeParse(value);
    if (!parsed.success) this.fail("invalid audited mutation result");
    if (parsed.data.status === "not_found")
      throw new MemberRepositoryError("member_not_found");
    if (parsed.data.status === "conflict")
      throw new MemberRepositoryError("conflict");
  }

  private searchExpression(search: string | undefined): string | null {
    if (!search) return null;
    const term = search.replace(/[(),\\"]/g, "");
    if (!term) return null;
    return MEMBER_SEARCH_COLUMNS.map(
      (column) => `${column}.ilike.%${term}%`,
    ).join(",");
  }

  private toMember(row: {
    role: string;
    created_at: string;
    users: {
      id: string;
      email: string;
      username: string | null;
      first_name: string | null;
      last_name: string | null;
      avatar_url: string | null;
      job_title: string | null;
      is_active: boolean;
    };
  }): Member {
    return {
      id: row.users.id,
      email: row.users.email,
      username: row.users.username,
      firstName: row.users.first_name,
      lastName: row.users.last_name,
      avatarUrl: row.users.avatar_url,
      jobTitle: row.users.job_title,
      isActive: row.users.is_active,
      role: this.baseRole(row.role),
      joinedAt: row.created_at,
      roles: [],
    };
  }

  private baseRole(value: string): BaseRole {
    if ((BASE_ROLES as readonly string[]).includes(value)) {
      return value as BaseRole;
    }
    this.logger.error("Member query returned an invalid base role");
    throw new MemberRepositoryError("unavailable");
  }

  private fail(message: string): never {
    if (message.includes("must retain at least one owner")) {
      throw new MemberRepositoryError("last_owner");
    }
    this.logger.error(`Member persistence failed: ${message}`);
    throw new MemberRepositoryError("unavailable");
  }
}

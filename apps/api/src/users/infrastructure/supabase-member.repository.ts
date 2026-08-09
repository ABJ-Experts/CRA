import { Injectable, Logger } from "@nestjs/common";
import {
  paged,
  resolvePage,
  type PageParams,
  type Paged,
} from "@repo/contracts/pagination";
import { BASE_ROLES, type BaseRole } from "@repo/contracts/permissions";
import type { Member } from "@repo/contracts/users";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  MemberRepositoryError,
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
  ): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .from("organization_members")
      .update({ role })
      .eq("organization_id", orgId)
      .eq("user_id", userId);
    if (error) this.fail(error.message);
  }

  async remove(orgId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .admin()
      .from("organization_members")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", userId);
    if (error) this.fail(error.message);
  }

  async setActive(
    orgId: string,
    userId: string,
    isActive: boolean,
  ): Promise<void> {
    if (!(await this.findMembership(orgId, userId))) {
      throw new MemberRepositoryError("member_not_found");
    }

    const { error } = await this.supabase
      .admin()
      .from("users")
      .update({ is_active: isActive })
      .eq("id", userId);
    if (error) this.fail(error.message);
  }

  async updateOwnProfile(userId: string, patch: ProfilePatch): Promise<void> {
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
    if (error) this.fail(error.message);
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

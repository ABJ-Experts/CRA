import { createHash, randomBytes } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { normalizeEmail } from "@repo/contracts/auth";
import type {
  AcceptInvitationResponse,
  Invitation,
} from "@repo/contracts/invitations";
import type { BaseRole } from "@repo/contracts/permissions";

import { AuditService } from "../audit/audit.service";
import { MailService } from "../mail/mail.service";
import { SupabaseService } from "../supabase/supabase.service";

const sha256 = (v: string): string =>
  createHash("sha256").update(v).digest("hex");

/** @deprecated Import `AcceptInvitationResponse` from the contracts package. */
export type AcceptResult = AcceptInvitationResponse;

/**
 * Invitations.
 *
 * The edge cases here are the point — this is the flow with the most ways to go
 * subtly wrong, and the reference handles them well enough to be worth copying
 * behaviour-for-behaviour:
 *
 *   inviting an existing account       -> 409 telling them to sign in and accept
 *   inviting an existing member        -> 400
 *   a second live invite to one email  -> 400 (partial unique index backs this)
 *   accepting twice                    -> SUCCESS with alreadyAccepted, not an error
 *   accepting an expired one           -> marked expired, then rejected
 *   resending from another org         -> 403
 *
 * The double-accept case is the one most often got wrong. A user who
 * double-clicks, or whose browser retries, must not see "invitation is no longer
 * pending" — they did nothing wrong and they ARE a member, so the honest answer
 * is success.
 *
 * The token is stored ONLY as sha256. The raw value exists in the emailed URL
 * and nowhere else, so a database read is not a working invitation.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  async create(
    orgId: string,
    actor: { id: string; email: string },
    input: {
      email: string;
      role: BaseRole;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<{ id: string }> {
    const email = normalizeEmail(input.email);

    if (email === normalizeEmail(actor.email)) {
      throw new BadRequestException({
        message: "You are already a member of this organization.",
        code: "cannot_invite_self",
      });
    }

    const { data: existingUser } = await this.supabase
      .admin()
      .from("users")
      .select("id")
      .eq("email", email)
      .maybeSingle();

    if (existingUser) {
      const { data: member } = await this.supabase
        .admin()
        .from("organization_members")
        .select("id")
        .eq("organization_id", orgId)
        .eq("user_id", existingUser.id)
        .maybeSingle();

      if (member) {
        throw new BadRequestException({
          message: "That person is already a member of this organization.",
          code: "already_member",
          fieldErrors: { email: "Already a member." },
        });
      }
    }

    const { data: pending } = await this.supabase
      .admin()
      .from("invitations")
      .select("id")
      .eq("organization_id", orgId)
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    if (pending) {
      throw new BadRequestException({
        message: "An invitation has already been sent to that address.",
        code: "invitation_pending",
        fieldErrors: { email: "An invitation is already outstanding." },
      });
    }

    const token = randomBytes(32).toString("hex");
    const days = this.config.getOrThrow<number>("INVITATION_TTL_DAYS");

    const { data, error } = await this.supabase
      .admin()
      .from("invitations")
      .insert({
        organization_id: orgId,
        invited_by: actor.id,
        email,
        role: input.role,
        first_name: input.firstName ?? null,
        last_name: input.lastName ?? null,
        token_hash: sha256(token),
        expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
      })
      .select("id")
      .single();

    if (error || !data) {
      this.logger.error(`Invitation insert failed: ${error?.message}`);
      throw new BadRequestException({
        message: "We could not create that invitation.",
        code: "invitation_failed",
      });
    }

    const org = await this.organization(orgId);
    await this.mail.sendInvitation(email, token, org.name, actor.email);

    this.audit.log({
      organizationId: orgId,
      userId: actor.id,
      actorEmail: actor.email,
      action: "invitation.created",
      entityType: "invitation",
      entityId: data.id,
      changes: { email, role: input.role },
    });

    return { id: data.id };
  }

  /**
   * Accept an invitation.
   *
   * The caller must already be signed in — the accept screen sends them through
   * sign-in or sign-up first. That is why an invitation for an address that
   * already has an account returns 409 at CREATE time with "sign in to accept":
   * there is no safe way to bind an invitation to a session that does not exist.
   */
  async accept(
    token: string,
    user: { id: string; email: string },
  ): Promise<AcceptResult> {
    const { data, error } = await this.supabase
      .admin()
      .rpc("accept_invitation_atomic", {
        p_token_hash: sha256(token),
        p_user_id: user.id,
        p_email: normalizeEmail(user.email),
      });
    const [result, ...extraResults] = data ?? [];
    if (error || !result || extraResults.length > 0) {
      this.logger.error(`Invitation acceptance failed: ${error?.message}`);
      this.throwAcceptanceFailure();
    }

    if (
      result.outcome === "accepted" ||
      result.outcome === "already_accepted"
    ) {
      const organization = this.acceptedOrganization(result);
      return {
        ok: true,
        alreadyAccepted: result.outcome === "already_accepted",
        organization,
      };
    }

    this.throwAcceptanceOutcome(result.outcome);
  }

  private acceptedOrganization(result: {
    invitation_id: string | null;
    organization_id: string | null;
    organization_name: string | null;
    organization_slug: string | null;
  }): AcceptResult["organization"] {
    if (
      !result.invitation_id ||
      !result.organization_id ||
      !result.organization_name ||
      !result.organization_slug
    ) {
      this.logger.error("Invitation acceptance returned an incomplete result");
      this.throwAcceptanceFailure();
    }

    return {
      id: result.organization_id,
      name: result.organization_name,
      slug: result.organization_slug,
    };
  }

  private throwAcceptanceOutcome(outcome: string): never {
    if (outcome === "not_found") {
      throw new NotFoundException({
        message: "That invitation link is not valid.",
        code: "invitation_not_found",
      });
    }
    if (outcome === "expired") {
      throw new BadRequestException({
        message: "That invitation has expired.",
        code: "invitation_expired",
      });
    }
    if (outcome === "email_mismatch") {
      throw new ForbiddenException({
        message: "That invitation was sent to a different email address.",
        code: "invitation_email_mismatch",
      });
    }
    if (outcome === "not_pending") {
      throw new BadRequestException({
        message: "That invitation is no longer valid.",
        code: "invitation_not_pending",
      });
    }
    if (outcome === "organization_not_found") {
      throw new NotFoundException({
        message: "That organization no longer exists.",
        code: "organization_not_found",
      });
    }

    this.logger.error(`Unexpected invitation acceptance outcome: ${outcome}`);
    this.throwAcceptanceFailure();
  }

  private throwAcceptanceFailure(): never {
    throw new BadRequestException({
      message: "We could not add you to that organization.",
      code: "membership_failed",
    });
  }

  async revoke(
    orgId: string,
    actor: { id: string; email: string },
    invitationId: string,
  ): Promise<void> {
    const { data: outcome, error } = await this.supabase
      .admin()
      .rpc("revoke_invitation_atomic", {
        p_organization_id: orgId,
        p_invitation_id: invitationId,
        p_actor_user_id: actor.id,
        p_actor_email: normalizeEmail(actor.email),
      });

    if (error) {
      this.logger.error(`Invitation revocation failed: ${error.message}`);
      this.throwRevocationFailure();
    }
    if (outcome === "revoked") return;
    if (outcome === "not_found") {
      throw new NotFoundException({
        message: "That invitation no longer exists.",
        code: "invitation_not_found",
      });
    }
    if (outcome === "already_accepted") {
      throw new ConflictException({
        message: "That invitation has already been accepted.",
        code: "invitation_already_accepted",
      });
    }
    if (outcome === "not_pending") {
      throw new BadRequestException({
        message: "That invitation is no longer valid.",
        code: "invitation_not_pending",
      });
    }

    this.logger.error(`Unexpected invitation revocation outcome: ${outcome}`);
    this.throwRevocationFailure();
  }

  private throwRevocationFailure(): never {
    throw new BadRequestException({
      message: "We could not revoke that invitation.",
      code: "invitation_failed",
    });
  }

  async list(orgId: string): Promise<Invitation[]> {
    // Refresh stale statuses first, so the list is honest rather than showing
    // long-dead invitations as "pending".
    await this.supabase.admin().rpc("expire_stale_invitations");

    const { data, error } = await this.supabase
      .admin()
      .from("invitations")
      .select("id, email, role, status, expires_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    if (error) {
      this.logger.error(`Invitation list failed: ${error.message}`);
      return [];
    }

    return (data ?? []).map((r) => ({
      id: r.id,
      email: r.email,
      role: r.role as Invitation["role"],
      status: r.status,
      expiresAt: r.expires_at,
    }));
  }

  private async organization(
    orgId: string,
  ): Promise<{ id: string; name: string; slug: string }> {
    const { data } = await this.supabase
      .admin()
      .from("organizations")
      .select("id, name, slug")
      .eq("id", orgId)
      .maybeSingle();

    if (!data) {
      throw new NotFoundException({
        message: "That organization no longer exists.",
        code: "organization_not_found",
      });
    }
    return data;
  }
}

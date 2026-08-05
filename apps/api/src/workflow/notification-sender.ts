import { Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { orgMember, userAccount, withTenant } from '../db';

// FR-WF-005: outbound notifications go through an Adapter so the transport (SMTP,
// later a provider API) is swappable without touching the domain. ADR-013.
export interface NotificationMessage {
  organisationId: string;
  category: 'obligation_deadline' | 'finding_state';
  subject: string;
  body: string;
  recipients: string[]; // email addresses
}

export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');

/**
 * Everyone in the organisation. Per-user preference filtering is TODO(V1)
 * (FR-WF-005) — but note FR-WF-008: a critical regulatory deadline notification
 * can be re-routed, never silenced, so this list is the floor rather than a
 * default that preferences may empty.
 */
export function orgRecipients(organisationId: string): Promise<string[]> {
  return withTenant({ organisationId }, async (tx) => {
    const rows = await tx
      .select({ email: userAccount.email })
      .from(orgMember)
      .innerJoin(userAccount, eq(userAccount.id, orgMember.userAccountId))
      .where(eq(orgMember.organisationId, organisationId));
    return rows.map((r) => r.email);
  });
}

export interface NotificationSender {
  send(message: NotificationMessage): Promise<void>;
  /** Recently sent messages (newest first) — powers the dashboard + tests. */
  recent(organisationId: string, limit?: number): NotificationMessage[];
}

/**
 * MVP transport: log the notification and keep a bounded in-memory ring. Loss of
 * this buffer degrades notification *timing* only, never deadline correctness —
 * the DB obligation_stage rows remain the source of truth (FR-WF-005, ADR-006).
 * TODO(V1): SmtpNotificationSender (nodemailer via Supabase Inbucket) behind this
 * same port, plus per-user preference filtering and digest batching.
 */
@Injectable()
export class LoggingNotificationSender implements NotificationSender {
  private readonly log = new Logger('Notifications');
  private readonly sent: NotificationMessage[] = [];
  private static readonly MAX = 200;

  send(message: NotificationMessage): Promise<void> {
    this.log.log(
      `[${message.category}] ${message.subject} -> ${message.recipients.join(', ') || '(no recipients)'}`,
    );
    this.sent.unshift(message);
    if (this.sent.length > LoggingNotificationSender.MAX) {
      this.sent.length = LoggingNotificationSender.MAX;
    }
    return Promise.resolve();
  }

  recent(organisationId: string, limit = 20): NotificationMessage[] {
    return this.sent
      .filter((m) => m.organisationId === organisationId)
      .slice(0, limit);
  }
}

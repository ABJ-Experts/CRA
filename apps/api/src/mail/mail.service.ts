import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createTransport, type Transporter } from "nodemailer";

/**
 * Outbound email.
 *
 * THE ONE THING THAT MUST NOT BE COPIED FROM THE REFERENCE:
 *   it builds a transport only when `enabled && host && user && pass` are all
 *   present. Mailpit — the local mail catcher on 54324, which is the entire
 *   local email story — has NO authentication, so a verbatim port silently
 *   no-ops every message. Sign-up then appears to hang forever on the verify
 *   screen with nothing in any log, because from the app's point of view the
 *   mail "sent" fine.
 *
 *   Here, SMTP_HOST alone is enough.
 *
 * Templates are inline template literals rather than files. `nest build` does
 * not copy non-TS assets into dist unless nest-cli.json is taught to, and a
 * template that exists in src but not dist fails only in production.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly appUrl: string;

  constructor(private readonly config: ConfigService) {
    const host = this.config.get<string>("SMTP_HOST");
    const port = this.config.get<number>("SMTP_PORT");
    const user = this.config.get<string>("SMTP_USER");
    const pass = this.config.get<string>("SMTP_PASS");

    this.from = this.config.getOrThrow<string>("SMTP_FROM");
    this.appUrl = this.config.getOrThrow<string>("APP_URL").replace(/\/+$/, "");

    if (!host) {
      this.transporter = null;
      this.logger.warn("SMTP_HOST is not set — email is disabled.");
    } else {
      const effectivePort = port ?? 587;
      this.transporter = createTransport({
        host,
        port: effectivePort,
        // Mailpit speaks plain SMTP on 54325. `secure: true` would attempt TLS
        // on connect and hang.
        secure: false,
        // Auth only when credentials exist. Passing `auth: { user: undefined }`
        // makes nodemailer attempt AUTH against a server that has none.
        ...(user && pass ? { auth: { user, pass } } : {}),
        // Mailpit presents a self-signed certificate if STARTTLS is negotiated.
        tls: { rejectUnauthorized: false },
      });
      this.logger.log(`Mail transport ready: ${host}:${effectivePort}`);
    }
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(`Email suppressed (no transport): "${subject}"`);
      return;
    }

    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      this.logger.log(`Sent "${subject}"`);
    } catch (error) {
      /*
       * Never let a mail failure fail the request that triggered it. A sign-up
       * whose confirmation email bounced is a user who can request a resend; a
       * sign-up that 500s because SMTP was down is a lost account. Logged, not
       * thrown.
       */
      this.logger.error(
        `Failed to send "${subject}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private layout(title: string, body: string): string {
    return `<!doctype html><html><body style="font-family:system-ui,-apple-system,sans-serif;background:#f6f7f9;padding:32px;margin:0">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px">
    <h1 style="font-size:20px;margin:0 0 16px;color:#1b1d1f">${title}</h1>
    ${body}
    <p style="font-size:12px;color:#8a8f98;margin-top:32px">If you did not expect this email you can safely ignore it.</p>
  </div>
</body></html>`;
  }

  async sendVerificationCode(to: string, code: string): Promise<void> {
    await this.send(
      to,
      "Your CRA verification code",
      this.layout(
        "Confirm your email",
        `<p style="color:#4b5058;font-size:14px">Enter this code to finish setting up your account:</p>
         <p style="font-size:32px;letter-spacing:8px;font-weight:600;margin:24px 0;color:#1b1d1f">${code}</p>
         <p style="color:#8a8f98;font-size:13px">The code expires shortly. Requesting a new one replaces this code.</p>`,
      ),
    );
  }

  async sendPasswordReset(to: string, token: string): Promise<void> {
    const url = `${this.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.send(
      to,
      "Reset your CRA password",
      this.layout(
        "Reset your password",
        `<p style="color:#4b5058;font-size:14px">Click below to choose a new password. The link can be used once.</p>
         <p style="margin:24px 0"><a href="${url}" style="background:#4a50d6;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px">Choose a new password</a></p>
         <p style="color:#8a8f98;font-size:12px;word-break:break-all">${url}</p>`,
      ),
    );
  }

  async sendInvitation(
    to: string,
    token: string,
    organizationName: string,
    inviterName: string | null,
  ): Promise<void> {
    const url = `${this.appUrl}/accept-invitation?token=${encodeURIComponent(token)}`;
    const who = inviterName
      ? `${inviterName} has invited`
      : "You have been invited";
    await this.send(
      to,
      `You have been invited to ${organizationName} on CRA`,
      this.layout(
        `Join ${organizationName}`,
        `<p style="color:#4b5058;font-size:14px">${who} you to join <strong>${organizationName}</strong>.</p>
         <p style="margin:24px 0"><a href="${url}" style="background:#4a50d6;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-size:14px">Accept invitation</a></p>
         <p style="color:#8a8f98;font-size:12px;word-break:break-all">${url}</p>`,
      ),
    );
  }
}

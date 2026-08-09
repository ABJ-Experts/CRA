import { Injectable } from "@nestjs/common";

import { MailService } from "../../mail/mail.service";
import type { InvitationNotifierPort } from "../application/invitation-notifier.port";

@Injectable()
export class MailInvitationNotifierAdapter implements InvitationNotifierPort {
  constructor(private readonly mail: MailService) {}

  send(
    email: string,
    rawToken: string,
    organizationName: string,
    inviterName: string | null,
  ): Promise<void> {
    return this.mail.sendInvitation(
      email,
      rawToken,
      organizationName,
      inviterName,
    );
  }
}

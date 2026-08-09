import type { Invitation } from "@repo/contracts/invitations";

import type { Result } from "../../common/domain/result";
import { failure, success } from "../../common/domain/result";
import type { InvitationRepository } from "./invitation-repository.port";

export type ListInvitationsError = Readonly<{
  code: "invitation_list_failed";
}>;

export class ListInvitationsQuery {
  constructor(private readonly repository: InvitationRepository) {}

  async execute(
    command: Readonly<{ orgId: string }>,
  ): Promise<Result<readonly Invitation[], ListInvitationsError>> {
    try {
      const invitations = await this.repository.list(command.orgId);
      return success(
        Object.freeze(
          invitations.map((invitation) => Object.freeze({ ...invitation })),
        ),
      );
    } catch {
      return failure(
        Object.freeze({ code: "invitation_list_failed" as const }),
      );
    }
  }
}

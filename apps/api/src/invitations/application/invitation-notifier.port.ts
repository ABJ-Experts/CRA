export interface InvitationNotifierPort {
  send(
    email: string,
    rawToken: string,
    organizationName: string,
    inviterName: string | null,
  ): Promise<void>;
}

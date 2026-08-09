export interface InvitationTokenPort {
  create(): Readonly<{ raw: string; hash: string }>;
  hash(rawToken: string): string;
}

import { transitionInvitation } from "./invitation-state";

describe("invitation state", () => {
  it.each([
    ["pending", "accept", "accepted"],
    ["pending", "revoke", "revoked"],
    ["pending", "decline", "declined"],
    ["pending", "expire", "expired"],
  ] as const)("allows %s -> %s", (from, event, to) => {
    expect(transitionInvitation(from, event)).toEqual({ ok: true, value: to });
  });

  it.each([
    ["accepted", "revoke"],
    ["revoked", "accept"],
    ["expired", "accept"],
    ["declined", "accept"],
  ] as const)("rejects %s -> %s", (from, event) => {
    expect(transitionInvitation(from, event)).toEqual({
      ok: false,
      error: { code: "invalid_invitation_transition", from, event },
    });
  });
});

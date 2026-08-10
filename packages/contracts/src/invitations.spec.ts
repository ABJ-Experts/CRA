import { describe, expect, it } from "vitest";

import {
  acceptInvitationResponseSchema,
  invitationSchema,
  resendInvitationInputSchema,
  resendInvitationResponseSchema,
} from "./invitations.js";

const invitation = {
  id: "2ad67e3b-6e5e-4cde-870f-2225e7da1200",
  email: "member@cra.test",
  role: "member",
  status: "pending",
  expiresAt: "2026-08-16T10:00:00.000Z",
};

const acceptance = {
  ok: true,
  alreadyAccepted: false,
  organization: {
    id: "2ad67e3b-6e5e-4cde-870f-2225e7da1201",
    name: "CRA",
    slug: "cra",
  },
};

describe("invitation wire contracts", () => {
  it("accepts the existing list and acceptance shapes", () => {
    expect(invitationSchema.parse(invitation)).toEqual(invitation);
    expect(acceptInvitationResponseSchema.parse(acceptance)).toEqual(
      acceptance,
    );
  });

  it("accepts the strict resend request and delivery-confirmed response", () => {
    const response = {
      id: invitation.id,
      delivery: "confirmed",
    } as const;

    expect(resendInvitationInputSchema.parse(undefined)).toEqual({});
    expect(resendInvitationResponseSchema.parse(response)).toEqual(response);
  });

  it.each([
    { unexpected: true },
    { delivery: "persisted", id: invitation.id },
    { delivery: "confirmed", id: "not-a-uuid" },
    { delivery: "confirmed", id: invitation.id, unexpected: true },
  ])("rejects an invalid resend boundary fixture", (value) => {
    const schema =
      "unexpected" in value && Object.keys(value).length === 1
        ? resendInvitationInputSchema
        : resendInvitationResponseSchema;

    expect(schema.safeParse(value).success).toBe(false);
  });

  it("rejects unknown invitation states", () => {
    expect(
      invitationSchema.safeParse({ ...invitation, status: "mystery" }).success,
    ).toBe(false);
  });

  it("accepts the timezone offset emitted by PostgREST", () => {
    const value = {
      ...invitation,
      expiresAt: "2026-08-16T10:00:00.000+00:00",
    };

    expect(invitationSchema.parse(value)).toEqual(value);
  });

  it.each([
    { ...invitation, id: "not-a-uuid" },
    { ...invitation, email: "not-an-email" },
    { ...invitation, role: "super-admin" },
    { ...invitation, expiresAt: "tomorrow" },
    { ...invitation, unrecognized: true },
  ])("rejects an invalid invitation boundary fixture", (value) => {
    expect(invitationSchema.safeParse(value).success).toBe(false);
  });

  it.each([
    { ...acceptance, ok: false },
    { ...acceptance, unrecognized: true },
    {
      ...acceptance,
      organization: { ...acceptance.organization, unrecognized: true },
    },
  ])("rejects an invalid acceptance boundary fixture", (value) => {
    expect(acceptInvitationResponseSchema.safeParse(value).success).toBe(false);
  });
});

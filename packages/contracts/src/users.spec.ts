import { describe, expect, it } from "vitest";

import { memberSchema } from "./users.js";

const member = {
  id: "2ad67e3b-6e5e-4cde-870f-2225e7da1202",
  email: "member@cra.test",
  username: null,
  firstName: null,
  lastName: null,
  avatarUrl: null,
  jobTitle: null,
  isActive: true,
  role: "member",
  joinedAt: "2026-08-09T10:00:00.000Z",
  roles: [],
};

describe("member wire contract", () => {
  it("accepts the existing member shape", () => {
    expect(memberSchema.parse(member)).toEqual(member);
  });

  it("accepts a nested custom-role summary", () => {
    const value = {
      ...member,
      roles: [
        {
          id: "2ad67e3b-6e5e-4cde-870f-2225e7da1204",
          name: "Billing reviewer",
          color: "neutral",
        },
      ],
    };

    expect(memberSchema.parse(value)).toEqual(value);
  });

  it("accepts the timezone offset emitted by PostgREST", () => {
    const value = { ...member, joinedAt: "2026-08-09T10:00:00.000+00:00" };

    expect(memberSchema.parse(value)).toEqual(value);
  });

  it.each([
    { ...member, id: "not-a-uuid" },
    { ...member, email: "not-an-email" },
    { ...member, role: "super-admin" },
    { ...member, joinedAt: "yesterday" },
    { ...member, unrecognized: true },
    {
      ...member,
      roles: [
        {
          id: "2ad67e3b-6e5e-4cde-870f-2225e7da1204",
          name: "Billing reviewer",
          color: "neutral",
          unrecognized: true,
        },
      ],
    },
  ])("rejects an invalid member boundary fixture", (value) => {
    expect(memberSchema.safeParse(value).success).toBe(false);
  });
});

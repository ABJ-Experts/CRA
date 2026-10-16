import { exportPrincipal } from "./export-principal";
import { ExportAccessDeniedError } from "../domain/export.errors";
import type { RequestUser } from "../../auth/auth.types";

const user: RequestUser = {
  id: "e5a9a4ae-922a-4b45-b976-ea1c0a68a45d",
  authUserId: "f73088f8-1236-467e-bd16-f240146642ee",
  organizationId: "5bb39a5a-7505-4c98-9e62-387824c4c069",
  sessionId: "6a2430e2-7fe6-4944-862b-dd1ed328633f",
  email: "owner@example.test",
  isActive: true,
  role: "owner",
  accessToken: "test",
  aal: "aal2",
};
describe("exportPrincipal", () => {
  it("uses the public user and verified organization/session", () =>
    expect(exportPrincipal(user)).toEqual({
      organizationId: user.organizationId,
      actorId: user.id,
      sessionId: user.sessionId,
      role: "owner",
    }));
  it.each([
    { isActive: false },
    { organizationId: null },
    { sessionId: undefined },
    { role: null },
  ])("denies invalid identity %j", (change) =>
    expect(() => exportPrincipal({ ...user, ...change })).toThrow(
      ExportAccessDeniedError,
    ),
  );
});

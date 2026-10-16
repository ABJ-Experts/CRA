// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemHealthScreen } from "./system-health-screen";
import { useSession } from "../../_providers/session-provider";
import { useMocksReady } from "../../_providers/providers";
import { systemHealthGateway } from "./system-health.gateway";
import { healthFixture, healthOrg } from "./system-health.fixture";
vi.mock("../../_providers/session-provider", () => ({ useSession: vi.fn() }));
vi.mock("../../_providers/providers", () => ({ useMocksReady: vi.fn() }));
const sessionState = {
  session: { user: { id: "u" }, organization: { id: healthOrg } },
  permissions: { can_view_system_health: true, can_edit_organization: false },
  isLoading: false,
  isError: false,
};
describe("system health access", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  it("waits for session and supports live backend disabled", () => {
    vi.mocked(useSession).mockReturnValue({
      ...sessionState,
      isLoading: true,
    } as never);
    vi.mocked(useMocksReady).mockReturnValue(false);
    const view = render(<SystemHealthScreen />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    vi.mocked(useMocksReady).mockReturnValue(true);
    vi.mocked(useSession).mockReturnValue(sessionState as never);
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "true");
    view.rerender(<SystemHealthScreen />);
    expect(screen.getByRole("status").textContent).toContain("live backend");
  });
  it("denies unverifiable access and missing membership", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
    vi.mocked(useMocksReady).mockReturnValue(true);
    vi.mocked(useSession).mockReturnValue({
      ...sessionState,
      isError: true,
    } as never);
    const view = render(<SystemHealthScreen />);
    expect(screen.getByRole("alert").textContent).toContain(
      "could not be verified",
    );
    vi.mocked(useSession).mockReturnValue({
      ...sessionState,
      session: null,
    } as never);
    view.rerender(<SystemHealthScreen />);
    expect(screen.getByRole("status").textContent).toContain(
      "current organization",
    );
  });
  it("uses the current session and hides on permission revocation", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
    vi.mocked(useMocksReady).mockReturnValue(true);
    vi.mocked(useSession).mockReturnValue(sessionState as never);
    const read = vi
      .spyOn(systemHealthGateway, "read")
      .mockResolvedValue(healthFixture);
    const view = render(<SystemHealthScreen />);
    await waitFor(() =>
      expect(read).toHaveBeenCalledWith(healthOrg, expect.any(AbortSignal)),
    );
    await screen.findByRole("table", { name: "Components" });
    vi.mocked(useSession).mockReturnValue({
      ...sessionState,
      permissions: { can_view_system_health: false },
    } as never);
    view.rerender(<SystemHealthScreen />);
    expect(screen.queryByRole("table", { name: "Components" })).toBeNull();
  });
});

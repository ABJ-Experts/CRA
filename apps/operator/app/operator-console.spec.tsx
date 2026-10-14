// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OperatorConsole } from "./operator-console";
import { OperatorRequestError } from "./operator-gateway";
import {
  instanceId,
  instances,
  operatorInstance,
  operatorSession,
  observedAt,
  tenants,
} from "./operator.fixture";
import {
  OperatorDetailTables,
  OperatorInstancesTable,
} from "./operator-tables";
function gateway() {
  return {
    session: vi.fn().mockResolvedValue(operatorSession),
    instances: vi.fn().mockResolvedValue(instances),
    instance: vi
      .fn()
      .mockResolvedValue({
        schemaVersion: 1,
        observedAt,
        instance: operatorInstance,
      }),
    tenants: vi.fn().mockResolvedValue(tenants),
  };
}
describe("read-only operator console", () => {
  afterEach(cleanup);
  it("loads scoped instance metadata and selected tenant details", async () => {
    const api = gateway();
    render(<OperatorConsole gateway={api} />);
    expect(screen.getByRole("status").textContent).toContain("Loading");
    await screen.findByRole("table", { name: "Authorized instances" });
    expect(screen.getByText("different")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "View Private deployment" }),
    );
    await screen.findByRole("table", { name: "Authorized tenants" });
    expect(api.instance).toHaveBeenCalledWith(
      instanceId,
      expect.any(AbortSignal),
    );
    expect(screen.getByText("expired read only")).toBeTruthy();
    expect(
      screen.getByRole("table", { name: "Source observations" }).textContent,
    ).toContain("Last successful collection");
    fireEvent.click(screen.getByRole("button", { name: "Back to instances" }));
    await screen.findByRole("table", { name: "Authorized instances" });
  });
  it.each([403, 409, 503])(
    "clears data on %s and permits explicit retry",
    async (status) => {
      const api = gateway();
      api.session.mockRejectedValueOnce(new OperatorRequestError(status));
      render(<OperatorConsole gateway={api} />);
      await screen.findByRole("alert");
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      await screen.findByRole("table", { name: "Authorized instances" });
    },
  );
  it("denies data when the mounted grant changes during a read", async () => {
    const api = gateway();
    api.session
      .mockResolvedValueOnce(operatorSession)
      .mockResolvedValueOnce({ ...operatorSession, grantRevision: "two" });
    render(<OperatorConsole gateway={api} />);
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("changed"),
    );
    expect(
      screen.queryByRole("table", { name: "Authorized instances" }),
    ).toBeNull();
  });
  it("navigates bounded pages and manually refreshes", async () => {
    const api = gateway();
    api.instances.mockResolvedValue({
      ...instances,
      nextCursor: "scope_cursor",
    } as never);
    render(<OperatorConsole gateway={api} />);
    await screen.findByRole("table", { name: "Authorized instances" });
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() =>
      expect(api.instances).toHaveBeenCalledWith(
        { cursor: "scope_cursor" },
        expect.any(AbortSignal),
      ),
    );
    await screen.findByRole("button", { name: "First page" });
    fireEvent.click(screen.getByRole("button", { name: "First page" }));
    await screen.findByRole("table", { name: "Authorized instances" });
    fireEvent.click(screen.getByRole("button", { name: "Refresh metadata" }));
    await waitFor(() => expect(api.instances).toHaveBeenCalledTimes(4));
  });
  it("rechecks mounted grants on the polling interval and cancels at unmount", async () => {
    const api = gateway();
    const interval = vi.spyOn(window, "setInterval");
    const view = render(<OperatorConsole gateway={api} />);
    await screen.findByRole("table", { name: "Authorized instances" });
    const poll = interval.mock.calls[0]?.[0] as () => void;
    api.session.mockRejectedValue(new OperatorRequestError(403));
    const { act } = await import("@testing-library/react");
    act(() => poll());
    await screen.findByRole("alert");
    view.unmount();
    expect(api.instances.mock.calls[0]?.[1]?.aborted).toBe(true);
    interval.mockRestore();
  });
  it("denies an out-of-scope list and denied detail selection", async () => {
    const api = gateway();
    api.session.mockResolvedValue({
      ...operatorSession,
      allowedInstanceIds: [],
    });
    const view = render(<OperatorConsole gateway={api} />);
    await screen.findByRole("alert");
    view.unmount();
    const other = gateway();
    render(<OperatorConsole gateway={other} />);
    await screen.findByRole("table", { name: "Authorized instances" });
    other.session.mockResolvedValue({
      ...operatorSession,
      allowedInstanceIds: [],
    });
    fireEvent.click(
      screen.getByRole("button", { name: "View Private deployment" }),
    );
    await screen.findByRole("alert");
    expect(other.instance).not.toHaveBeenCalled();
  });
  it("renders empty scopes, unknown metadata and tenant source provenance", () => {
    const view = render(
      <OperatorInstancesTable instances={[]} onSelect={vi.fn()} />,
    );
    expect(screen.getByText(/No instances/)).toBeTruthy();
    view.rerender(
      <OperatorInstancesTable
        instances={[
          {
            ...operatorInstance,
            version: null,
            expectedVersion: null,
            tenantCount: 4,
            licenceSummary: {
              active: 1,
              expiredReadOnly: 2,
              grace: null,
              invalid: null,
              missing: null,
              unknown: null,
            },
          },
        ]}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("Unverified")).toBeTruthy();
    view.rerender(
      <OperatorDetailTables
        instance={{
          ...operatorInstance,
          version: null,
          expectedVersion: null,
          sources: [],
        }}
        tenants={[]}
      />,
    );
    expect(screen.getByText(/No successful source/)).toBeTruthy();
    expect(screen.getByText(/No tenants/)).toBeTruthy();
    view.rerender(
      <OperatorDetailTables
        instance={{
          ...operatorInstance,
          sources: [{ ...operatorInstance.sources[0]!, reasons: [] }],
        }}
        tenants={[
          {
            ...tenants.tenants[0]!,
            licenceState: null,
            sources: operatorInstance.sources,
          },
        ]}
      />,
    );
    expect(
      screen.getByRole("table", { name: "Authorized tenants" }).textContent,
    ).toContain("last success");
    expect(screen.getByText("None")).toBeTruthy();
  });
});

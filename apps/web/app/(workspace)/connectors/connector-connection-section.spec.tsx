// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import type { ConnectorConnectionState } from "@repo/contracts/connectors/types";
import { ConnectorConnectionSection } from "./connector-connection-section";
import type { Connector } from "../../_features/connectors/connectors.schemas";

const CONNECTOR: Connector = {
  id: "11111111-1111-4111-8111-111111111111",
  organizationId: "22222222-2222-4222-8222-222222222222",
  connectorType: "reference_conformance",
  displayName: "Reference PLM",
  adapterVersion: "1.0.0",
  mappingVersion: "1.0.0",
  connectionConfig: {},
  commitPolicy: "manual",
  enabled: true,
  lastTestedAt: null,
  lastTestOutcome: null,
  lastTestErrorCode: null,
  archivedAt: null,
  version: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  createdBy: "33333333-3333-4333-8333-333333333333",
  updatedAt: "2026-08-01T00:00:00.000Z",
  updatedBy: "33333333-3333-4333-8333-333333333333",
  hasSecret: false,
};

const update = vi.fn().mockResolvedValue({ connector: CONNECTOR });
const secret = vi.fn().mockResolvedValue({ connector: CONNECTOR });
const test = vi.fn().mockResolvedValue(undefined);
let testPending = false;
const revoke = vi.fn().mockResolvedValue({ connector: CONNECTOR });
const disconnect = vi.fn().mockResolvedValue({ connector: CONNECTOR });
const reconnect = vi.fn().mockResolvedValue({ connector: CONNECTOR });

vi.mock("../../_features/connectors/connectors.queries", () => ({
  useUpdateConnectorMutation: () => ({
    isPending: false,
    mutateAsync: update,
  }),
  useSetConnectorSecretMutation: () => ({
    isPending: false,
    mutateAsync: secret,
  }),
  useRevokeConnectorSecretMutation: () => ({
    isPending: false,
    mutateAsync: revoke,
  }),
  useDisconnectConnectorMutation: () => ({
    isPending: false,
    mutateAsync: disconnect,
  }),
  useReconnectConnectorMutation: () => ({
    isPending: false,
    mutateAsync: reconnect,
  }),
  useTestConnectorMutation: () => ({
    isPending: testPending,
    mutateAsync: test,
  }),
}));

describe("ConnectorConnectionSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    testPending = false;
  });

  it("shows not-tested-yet before any test has run", () => {
    render(
      <ConnectorConnectionSection
        connector={CONNECTOR}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Not tested yet")).toBeInTheDocument();
  });

  it("shows the testing state while the test mutation is pending", () => {
    testPending = true;
    render(
      <ConnectorConnectionSection
        connector={CONNECTOR}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Testing…")).toBeInTheDocument();
  });

  it("shows unauthorized for an auth-flavoured failed test", () => {
    render(
      <ConnectorConnectionSection
        connector={{
          ...CONNECTOR,
          lastTestOutcome: "failure",
          lastTestErrorCode: "auth_failed",
        }}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Unauthorized")).toBeInTheDocument();
  });

  it("shows connection successful after a successful test", () => {
    render(
      <ConnectorConnectionSection
        connector={{ ...CONNECTOR, lastTestOutcome: "success" }}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Connection successful")).toBeInTheDocument();
  });

  it("calls the test mutation when Test connection is clicked", () => {
    render(
      <ConnectorConnectionSection
        connector={{ ...CONNECTOR, hasSecret: true }}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(test).toHaveBeenCalledTimes(1);
  });

  it("shows the secret as not configured, then configured", () => {
    const { rerender } = render(
      <ConnectorConnectionSection
        connector={CONNECTOR}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Not configured")).toBeInTheDocument();
    rerender(
      <ConnectorConnectionSection
        connector={{ ...CONNECTOR, hasSecret: true }}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("Configured")).toBeInTheDocument();
  });

  it("never renders the secret value, and hides the rotate form from non-owners", () => {
    render(
      <ConnectorConnectionSection
        connector={{ ...CONNECTOR, hasSecret: true }}
        canEdit
        isOwner={false}
        onReload={vi.fn()}
      />,
    );
    expect(
      screen.getByText(
        "Only the organization owner can set or rotate this connector's secret.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Rotate secret" }),
    ).not.toBeInTheDocument();
  });
});

describe("connection draft and write-only commands", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  it("preserves drafts and requires explicit rebasing after refetch", () => {
    const { rerender } = render(
      <ConnectorConnectionSection
        connector={CONNECTOR}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Unsaved name" },
    });
    rerender(
      <ConnectorConnectionSection
        connector={{ ...CONNECTOR, displayName: "Other session", version: 2 }}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Display name")).toHaveValue("Unsaved name");
    expect(
      screen.getByText(/newer configuration is available/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Save connection" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Reapply draft to current version" }),
    );
    expect(
      screen.getByRole("button", { name: "Save connection" }),
    ).not.toBeDisabled();
    expect(screen.getByLabelText("Display name")).toHaveFocus();
  });
  it("submits a versioned credential and clears the local secret after success", async () => {
    render(
      <ConnectorConnectionSection
        connector={CONNECTOR}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Set secret"), {
      target: { value: "credential-canary" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Set secret" }));
    await waitFor(() =>
      expect(secret).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: 1,
          idempotencyKey: expect.any(String),
          secretValue: "credential-canary",
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("Set secret")).toHaveValue(""),
    );
  });
});

describe("connection operational failures and controls", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });
  function open(connector: Connector = { ...CONNECTOR, hasSecret: true }) {
    return render(
      <ConnectorConnectionSection
        connector={connector}
        canEdit
        isOwner
        onReload={vi.fn()}
      />,
    );
  }
  it("edits and saves all supported non-secret metadata", async () => {
    open();
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Changed" },
    });
    fireEvent.change(screen.getByLabelText("Mapping version"), {
      target: { value: "v2" },
    });
    fireEvent.change(screen.getByLabelText("Commit policy"), {
      target: { value: "auto" },
    });
    fireEvent.change(
      screen.getByLabelText("Connection config (JSON, no secrets)"),
      { target: { value: '{"scopeFilter":{"scenario":"create"}}' } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          mappingVersion: "v2",
          commitPolicy: "auto",
          expectedVersion: 1,
        }),
      ),
    );
    expect(
      await screen.findByText(
        "Connector saved. Test again before starting new work.",
      ),
    ).toBeInTheDocument();
  });
  it.each([
    ["{", "Connection config must be valid JSON."],
    [
      '{"token":"canary"}',
      "Check configuration metadata. Only supported non-secret fields are allowed.",
    ],
  ])(
    "rejects malformed or secret-bearing configuration %s",
    (value, message) => {
      open();
      fireEvent.change(
        screen.getByLabelText("Connection config (JSON, no secrets)"),
        { target: { value } },
      );
      fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(update).not.toHaveBeenCalled();
    },
  );
  it("requires a reason, then disconnects and revokes through explicit commands", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(
      screen.getByText("Enter a reason for this action."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason for disconnect or revoke"), {
      target: { value: "Maintenance" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    await waitFor(() =>
      expect(disconnect).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "Maintenance", expectedVersion: 1 }),
      ),
    );
    fireEvent.change(screen.getByLabelText("Reason for disconnect or revoke"), {
      target: { value: "Revoke credential" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Revoke credential" }));
    await waitFor(() => expect(revoke).toHaveBeenCalledTimes(1));
  });
  it("permits testing a disconnected credential before reconnect", async () => {
    open({ ...CONNECTOR, hasSecret: true, enabled: false });
    expect(
      screen.getByRole("button", { name: "Test connection" }),
    ).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reconnect" }));
    await waitFor(() =>
      expect(reconnect).toHaveBeenCalledWith(
        expect.objectContaining({ expectedVersion: 1 }),
      ),
    );
  });
  it("keeps a conflict draft until explicit discard and exposes reload", async () => {
    update.mockRejectedValueOnce(
      new ApiClientError("api", "Conflict", 409, "conflict"),
    );
    const reload = vi.fn();
    const { rerender } = render(
      <ConnectorConnectionSection
        connector={CONNECTOR}
        canEdit
        isOwner
        onReload={reload}
      />,
    );
    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "My draft" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save connection" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reload current data" }),
      ).toBeInTheDocument(),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Reload current data" }),
    );
    expect(reload).toHaveBeenCalled();
    rerender(
      <ConnectorConnectionSection
        connector={{ ...CONNECTOR, version: 2, displayName: "Server value" }}
        canEdit
        isOwner
        onReload={reload}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Discard draft and use current data",
      }),
    );
    expect(screen.getByLabelText("Display name")).toHaveValue("Server value");
  });
  it.each([
    [
      new ApiClientError("api", "Denied", 403),
      "You do not have permission to perform that action.",
    ],
    [
      new ApiClientError("api", "Missing", 404),
      "This connector is unavailable.",
    ],
    [
      new ApiClientError("network", "Offline"),
      "We could not reach the connector registry.",
    ],
    [
      new ApiClientError("api", "Safe provider outage", 503),
      "Safe provider outage",
    ],
    [new Error("internal canary"), "The secret could not be saved."],
  ])(
    "shows safe credential errors without server details",
    async (error, message) => {
      secret.mockRejectedValueOnce(error);
      open(CONNECTOR);
      fireEvent.change(screen.getByLabelText("Set secret"), {
        target: { value: "canary" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Set secret" }));
      expect(await screen.findByText(message)).toBeInTheDocument();
    },
  );
  it("rejects empty credentials and shows test/control outage recovery", async () => {
    open(CONNECTOR);
    fireEvent.click(screen.getByRole("button", { name: "Set secret" }));
    expect(secret).not.toHaveBeenCalled();
    cleanup();
    test.mockRejectedValueOnce(new Error("upstream canary"));
    disconnect.mockRejectedValueOnce(new Error("upstream canary"));
    open();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(
      await screen.findByText("The connection test could not run."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Reason for disconnect or revoke"), {
      target: { value: "Maintenance" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    expect(
      await screen.findByText("The connection action could not be completed."),
    ).toBeInTheDocument();
  });
  it("renders server-derived scopes and safe state with non-colour text", () => {
    const connection: ConnectorConnectionState = {
      status: "degraded",
      reason: "missing_scope",
      connectionRevision: 1,
      credentialRevision: 1,
      lastSyncAt: "2026-09-28T10:00:00.000Z",
      scope: {
        status: "known",
        policyVersion: "v1",
        requiredScopes: ["read"],
        grantedScopes: ["admin"],
        missingScopes: ["read"],
        excessScopes: ["admin"],
        warnings: ["excess_privileges", "missing_required_scope"],
        checkedAt: null,
      },
      test: {
        category: "not_tested",
        message:
          "Test this connection after configuration or credential changes.",
        checkedAt: null,
      },
    };
    render(
      <ConnectorConnectionSection
        connector={{
          ...CONNECTOR,
          lastTestOutcome: "failure",
          lastTestErrorCode: "unreachable",
        }}
        connection={connection}
        canEdit={false}
        isOwner={false}
        onReload={vi.fn()}
      />,
    );
    expect(screen.getByText("State: degraded")).toBeInTheDocument();
    expect(
      screen.getByText("Required privileges missing: read"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Save connection" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Connection failed")).toBeInTheDocument();
  });
});

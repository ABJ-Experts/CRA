// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../../_lib/http/api-client";
import { ChatChannelPanel } from "./chat-channel-panel";

const organizationId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const channelId = "33333333-3333-4333-8333-333333333333";
const testId = "44444444-4444-4444-8444-444444444444";

const channel = {
  id: channelId,
  organizationId,
  mode: "slack_webhook",
  displayName: "Operations",
  eventClasses: ["high_severity_alert"],
  productIds: [productId],
  includeOrganizationWide: false,
  enabled: false,
  verified: false,
  safeErrorCode: null,
  version: 1,
  createdAt: "2026-10-02T10:00:00.000Z",
  updatedAt: "2026-10-02T10:00:00.000Z",
} as const;

const api = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  test: { mutateAsync: vi.fn(), isPending: false },
  confirm: { mutateAsync: vi.fn(), isPending: false },
  enable: { mutateAsync: vi.fn(), isPending: false },
  retry: { mutateAsync: vi.fn(), isPending: false },
  channels: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  deliveries: {
    data: undefined as unknown,
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: vi.fn(),
  },
  deliveryEnabled: [] as boolean[],
}));

vi.mock("./notifications.queries", () => ({
  useChatChannelsQuery: () => api.channels,
  useChatDeliveriesQuery: (_query: unknown, enabled: boolean) => {
    api.deliveryEnabled.push(enabled);
    return api.deliveries;
  },
  useCreateChatChannelMutation: () => api.create,
  useUpdateChatChannelMutation: () => api.update,
  useTestChatChannelMutation: () => api.test,
  useConfirmChatChannelMutation: () => api.confirm,
  useSetChatChannelEnabledMutation: () => api.enable,
  useRetryChatDeliveryMutation: () => api.retry,
  useChatProductsQuery: () => ({
    data: {
      products: {
        rows: [{ id: productId, name: "Device A", internalCode: "A-1" }],
        total: 1,
      },
    },
    isLoading: false,
    isError: false,
  }),
}));

describe("ChatChannelPanel", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    api.channels.data = { channels: [] };
    api.channels.isLoading = false;
    api.channels.isError = false;
    api.channels.error = null;
    api.deliveries.data = { rows: [], nextCursor: null };
    api.deliveries.isLoading = false;
    api.deliveries.isError = false;
    api.deliveries.error = null;
  });

  afterEach(() => {
    cleanup();
    vi.resetAllMocks();
    vi.unstubAllGlobals();
    api.deliveryEnabled = [];
  });

  it("keeps chat setup hidden from non-admins and does not poll audit history without permission", () => {
    render(<ChatChannelPanel canManage={false} canViewAudit={false} />);
    expect(screen.getByText(/Only organization administrators/)).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /Create chat channel/ }),
    ).toBeNull();
    expect(api.deliveryEnabled.at(-1)).toBe(false);
  });

  it("explains an automatically disabled route without exposing provider details", () => {
    api.channels.data = {
      channels: [{ ...channel, safeErrorCode: "route_admin_revoked" }],
    };
    render(<ChatChannelPanel canManage canViewAudit />);

    expect(
      screen.getByText(
        "Route disabled because its configuring admin lost access. Retest and confirm before enabling.",
      ),
    ).toBeVisible();
    expect(screen.getByText(/Needs test/)).toBeVisible();
  });

  it("shows the exact generic disclosure preview before creating a route", async () => {
    api.create.mutateAsync.mockResolvedValue({ channel });
    render(<ChatChannelPanel canManage canViewAudit />);

    fireEvent.change(screen.getByLabelText(/^Channel name/), {
      target: { value: "Operations" },
    });
    fireEvent.change(screen.getByLabelText("Webhook URL"), {
      target: { value: "https://hooks.slack.com/services/test/secret" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Device A/ }));
    expect(
      screen.getByText(/No source titles, findings, drafts, or evidence/),
    ).toBeVisible();
    expect(
      screen.getByText(
        /CRA Sentinel\s+High-severity alert · High\s+Event time: <UTC event time>\s+Open in CRA: <trusted application link>/,
      ),
    ).toBeVisible();
    expect(
      screen.queryByText("hooks.slack.com/services/test/secret"),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Create chat channel" }),
    );
    await waitFor(() =>
      expect(api.create.mutateAsync).toHaveBeenCalledWith({
        displayName: "Operations",
        eventClasses: ["high_severity_alert"],
        productIds: [productId],
        includeOrganizationWide: false,
        destination: {
          mode: "slack_webhook",
          webhookUrl: "https://hooks.slack.com/services/test/secret",
        },
        idempotencyKey: expect.any(String),
      }),
    );
    expect(screen.getByLabelText("Webhook URL")).toHaveValue("");
  });

  it("requires a synthetic test and destination code before enabling a channel", async () => {
    api.channels.data = { channels: [channel] };
    api.test.mutateAsync.mockResolvedValue({
      testId,
      expiresAt: "2026-10-02T10:15:00.000Z",
      status: "provider_accepted",
    });
    api.channels.refetch.mockResolvedValue({
      data: { channels: [{ ...channel, version: 2 }] },
    });
    api.confirm.mutateAsync.mockResolvedValue({
      channel: { ...channel, verified: true, version: 2 },
    });
    render(<ChatChannelPanel canManage canViewAudit />);

    expect(
      screen.getByRole("button", { name: "Enable Operations" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Send test to Operations" }),
    );
    await waitFor(() => expect(api.test.mutateAsync).toHaveBeenCalled());
    expect(screen.getByText(/A synthetic test was accepted/)).toBeVisible();
    fireEvent.change(
      screen.getByLabelText("Confirmation code for Operations"),
      {
        target: { value: "123456" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm Operations" }));
    await waitFor(() =>
      expect(api.confirm.mutateAsync).toHaveBeenCalledWith({
        channelId,
        input: {
          expectedVersion: 2,
          idempotencyKey: expect.any(String),
          testId,
          code: "123456",
        },
      }),
    );
  });

  it("preserves a destination draft after a version conflict and reports an offline history error", async () => {
    api.channels.data = { channels: [channel] };
    api.update.mutateAsync.mockRejectedValue(
      new ApiClientError("api", "Conflict", 409),
    );
    api.deliveries.isError = true;
    api.deliveries.error = new ApiClientError("network", "Offline");
    render(<ChatChannelPanel canManage canViewAudit />);

    fireEvent.click(screen.getByRole("button", { name: "Edit Operations" }));
    fireEvent.change(screen.getByLabelText(/^Channel name/), {
      target: { value: "Response team" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save chat channel" }));
    await waitFor(() => expect(api.update.mutateAsync).toHaveBeenCalled());
    expect(screen.getByLabelText(/^Channel name/)).toHaveValue("Response team");
    expect(screen.getByRole("alert")).toHaveTextContent(/changed/);
    expect(screen.getByText(/offline/i)).toBeVisible();
  });

  it.each([
    {
      label: "Slack bot",
      mode: "slack_bot",
      fields: [
        ["Slack bot token", "xoxb-abcdefghijklmnop"],
        ["Slack channel ID", "CABCDEFGHI"],
      ],
      destination: {
        mode: "slack_bot",
        botToken: "xoxb-abcdefghijklmnop",
        channelId: "CABCDEFGHI",
      },
    },
    {
      label: "Microsoft Teams Workflow webhook",
      mode: "teams_workflow_webhook",
      fields: [
        ["Webhook URL", "https://workflow.example.com/hook?token=secret"],
      ],
      destination: {
        mode: "teams_workflow_webhook",
        webhookUrl: "https://workflow.example.com/hook?token=secret",
      },
    },
    {
      label: "Microsoft Teams proactive bot",
      mode: "teams_bot_proactive",
      fields: [
        ["Microsoft tenant ID", "55555555-5555-4555-8555-555555555555"],
        ["Bot application ID", "66666666-6666-4666-8666-666666666666"],
        ["Bot client secret", "client-secret-123"],
        ["Bot service URL", "https://smba.trafficmanager.net/emea/"],
        ["Conversation ID", "conversation-123"],
      ],
      destination: {
        mode: "teams_bot_proactive",
        tenantId: "55555555-5555-4555-8555-555555555555",
        appId: "66666666-6666-4666-8666-666666666666",
        clientSecret: "client-secret-123",
        serviceUrl: "https://smba.trafficmanager.net/emea/",
        conversationId: "conversation-123",
      },
    },
  ])(
    "creates a $label route with explicit organization-wide scope",
    async ({ label, fields, destination }) => {
      api.create.mutateAsync.mockResolvedValue({ channel });
      render(<ChatChannelPanel canManage canViewAudit />);
      fireEvent.change(screen.getByLabelText(/^Channel name/), {
        target: { value: "Operations" },
      });
      fireEvent.change(screen.getByLabelText("Delivery mode"), {
        target: { value: destination.mode },
      });
      for (const [field, value] of fields) {
        if (!field || !value) throw new Error("Invalid test field fixture");
        fireEvent.change(screen.getByLabelText(field), { target: { value } });
      }
      fireEvent.click(
        screen.getByRole("checkbox", {
          name: /Include organization-wide deadline alerts/,
        }),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Create chat channel" }),
      );
      await waitFor(() =>
        expect(api.create.mutateAsync).toHaveBeenCalledWith({
          displayName: "Operations",
          eventClasses: ["high_severity_alert"],
          productIds: [],
          includeOrganizationWide: true,
          destination,
          idempotencyKey: expect.any(String),
        }),
      );
      expect(screen.getByText(label, { exact: false })).toBeVisible();
    },
  );

  it("keeps an empty edited secret unchanged and applies a verified enable version", async () => {
    api.channels.data = {
      channels: [{ ...channel, verified: true, version: 2 }],
    };
    api.update.mutateAsync.mockResolvedValue({
      channel: {
        ...channel,
        displayName: "Response team",
        verified: true,
        version: 3,
      },
    });
    api.enable.mutateAsync.mockResolvedValue({
      channel: {
        ...channel,
        displayName: "Response team",
        verified: true,
        enabled: true,
        version: 4,
      },
    });
    render(<ChatChannelPanel canManage canViewAudit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Operations" }));
    fireEvent.change(screen.getByLabelText(/^Channel name/), {
      target: { value: "Response team" },
    });
    fireEvent.change(screen.getByLabelText("Webhook URL"), {
      target: { value: "temporary" },
    });
    fireEvent.change(screen.getByLabelText("Webhook URL"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save chat channel" }));
    await waitFor(() =>
      expect(api.update.mutateAsync).toHaveBeenCalledWith({
        channelId,
        input: expect.objectContaining({
          expectedVersion: 2,
          displayName: "Response team",
          destination: undefined,
        }),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Enable Response team" }),
    );
    await waitFor(() =>
      expect(api.enable.mutateAsync).toHaveBeenCalledWith({
        channelId,
        input: {
          expectedVersion: 3,
          idempotencyKey: expect.any(String),
          enabled: true,
        },
      }),
    );
  });

  it("shows bounded failure history and retries only exhausted entries", async () => {
    const failed = {
      id: "77777777-7777-4777-8777-777777777777",
      channelId,
      eventClass: "countdown_warning",
      status: "exhausted",
      sourceType: "reporting_obligation",
      sourceId: "88888888-8888-4888-8888-888888888888",
      sourceRevision: "2",
      attemptCount: 6,
      lastAttemptAt: "2026-10-02T10:00:00.000Z",
      nextAttemptAt: null,
      safeErrorCode: "vendor_unavailable",
      createdAt: "2026-10-02T09:00:00.000Z",
      updatedAt: "2026-10-02T10:00:00.000Z",
      version: 3,
    };
    api.deliveries.data = {
      rows: [
        failed,
        {
          ...failed,
          id: "99999999-9999-4999-8999-999999999999",
          status: "uncertain",
        },
      ],
      nextCursor: "page_2",
    };
    api.retry.mutateAsync.mockResolvedValue({
      delivery: { ...failed, status: "queued" },
    });
    render(<ChatChannelPanel canManage canViewAudit />);

    expect(
      screen.getByText(/The vendor may have accepted this message/),
    ).toBeVisible();
    expect(
      screen.getAllByRole("button", { name: /Retry delivery/ }),
    ).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: `Retry delivery ${failed.id}` }),
    );
    await waitFor(() =>
      expect(api.retry.mutateAsync).toHaveBeenCalledWith({
        deliveryId: failed.id,
        input: { expectedVersion: 3, idempotencyKey: expect.any(String) },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: `Retry delivery ${failed.id}` }),
      ).toBeDisabled(),
    );
    const uncertainId = "99999999-9999-4999-8999-999999999999";
    fireEvent.click(
      screen.getByRole("button", { name: `Review retry ${uncertainId}` }),
    );
    expect(screen.getByText(/Retrying may duplicate a message/)).toBeVisible();
    expect(api.retry.mutateAsync).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: `Confirm retry delivery ${uncertainId}`,
      }),
    );
    await waitFor(() =>
      expect(api.retry.mutateAsync).toHaveBeenCalledWith({
        deliveryId: uncertainId,
        input: { expectedVersion: 3, idempotencyKey: expect.any(String) },
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(screen.getByRole("button", { name: "Previous page" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(screen.queryByRole("button", { name: "Previous page" })).toBeNull();
    expect(screen.getByLabelText("Delivery state")).toHaveValue("");
  });

  it("keeps invalid route fields local and offers a retry for unavailable channel data", async () => {
    api.channels.isError = true;
    api.channels.error = new ApiClientError("network", "Offline");
    render(<ChatChannelPanel canManage canViewAudit />);
    fireEvent.change(screen.getByLabelText(/^Channel name/), {
      target: { value: "Operations" },
    });
    fireEvent.change(screen.getByLabelText("Webhook URL"), {
      target: { value: "http://localhost/secret" },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Device A/ }));
    fireEvent.click(
      screen.getByRole("button", { name: "Create chat channel" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/HTTPS/);
    expect(screen.getByLabelText("Webhook URL")).toHaveValue(
      "http://localhost/secret",
    );
    expect(api.create.mutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry channels" }));
    expect(api.channels.refetch).toHaveBeenCalledTimes(1);
  });

  it("preserves a changed destination through an outage and requires a fresh test after save", async () => {
    api.channels.data = { channels: [channel] };
    api.update.mutateAsync.mockRejectedValueOnce(
      new ApiClientError("network", "Offline"),
    );
    api.update.mutateAsync.mockResolvedValueOnce({
      channel: { ...channel, version: 2, verified: false },
    });
    render(<ChatChannelPanel canManage canViewAudit />);
    fireEvent.click(screen.getByRole("button", { name: "Edit Operations" }));
    fireEvent.change(screen.getByLabelText("Webhook URL"), {
      target: { value: "https://hooks.slack.com/services/T/B/NEWSECRET" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save chat channel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/offline/i);
    expect(screen.getByLabelText("Webhook URL")).toHaveValue(
      "https://hooks.slack.com/services/T/B/NEWSECRET",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save chat channel" }));
    await waitFor(() =>
      expect(api.update.mutateAsync).toHaveBeenLastCalledWith({
        channelId,
        input: expect.objectContaining({
          destination: {
            mode: "slack_webhook",
            webhookUrl: "https://hooks.slack.com/services/T/B/NEWSECRET",
          },
        }),
      }),
    );
    expect(
      screen.getByRole("button", { name: "Enable Operations" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Send a new synthetic test and confirm the code before enabling.",
    );
  });

  it("shows an audit-only reader delivery state without setup or retry controls", () => {
    api.deliveries.isLoading = true;
    render(<ChatChannelPanel canManage={false} canViewAudit />);
    expect(screen.getByText("Loading chat deliveries…")).toBeVisible();
    expect(screen.queryByLabelText("Channel name")).toBeNull();
    expect(screen.queryByRole("button", { name: /Retry delivery/ })).toBeNull();
    expect(api.deliveryEnabled.at(-1)).toBe(true);
  });

  it("clears an unsaved secret and pending test code when the verified organization changes", async () => {
    api.channels.data = { channels: [channel] };
    api.test.mutateAsync.mockResolvedValue({
      testId,
      expiresAt: "2026-10-02T10:15:00.000Z",
      status: "provider_accepted",
    });
    api.channels.refetch.mockResolvedValue({
      data: { channels: [{ ...channel, version: 2 }] },
    });
    const view = render(
      <ChatChannelPanel key={organizationId} canManage canViewAudit />,
    );
    fireEvent.change(screen.getByLabelText("Webhook URL"), {
      target: { value: "https://hooks.slack.com/services/T/B/unsaved-secret" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Send test to Operations" }),
    );
    expect(
      await screen.findByLabelText("Confirmation code for Operations"),
    ).toBeVisible();

    api.channels.data = { channels: [] };
    view.rerender(
      <ChatChannelPanel key="another-organization" canManage canViewAudit />,
    );
    expect(screen.getByLabelText("Webhook URL")).toHaveValue("");
    expect(
      screen.queryByLabelText("Confirmation code for Operations"),
    ).toBeNull();
    expect(screen.queryByText("Operations")).toBeNull();
  });

  it("keeps the entered confirmation code after an invalid-code response", async () => {
    api.channels.data = { channels: [channel] };
    api.test.mutateAsync.mockResolvedValue({
      testId,
      expiresAt: "2026-10-02T10:15:00.000Z",
      status: "provider_accepted",
    });
    api.channels.refetch.mockResolvedValue({
      data: { channels: [{ ...channel, version: 2 }] },
    });
    api.confirm.mutateAsync.mockRejectedValue(
      new ApiClientError("api", "Invalid code", 422),
    );
    render(<ChatChannelPanel canManage canViewAudit />);
    fireEvent.click(
      screen.getByRole("button", { name: "Send test to Operations" }),
    );
    const code = await screen.findByLabelText(
      "Confirmation code for Operations",
    );
    fireEvent.change(code, { target: { value: "000000" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm Operations" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /invalid or expired/,
    );
    expect(code).toHaveValue("000000");
  });
});

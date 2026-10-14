import { describe, expect, it, vi } from "vitest";
import { SupportDiagnosticsGateway } from "./support-diagnostics.gateway";

const org = "00000000-0000-4000-8000-000000000001";
describe("support diagnostic gateway boundaries", () => {
  it("rejects an invalid selection before making a request", async () => {
    const request = vi.fn();
    const gateway = new SupportDiagnosticsGateway(request as never);
    await expect(
      gateway.preview(org, { categories: [], from: "bad", to: "bad" }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects malformed and cross-organization responses", async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ organizationId: org, items: [], nextCursor: null });
    const gateway = new SupportDiagnosticsGateway(request as never);
    await expect(gateway.list(org)).resolves.toMatchObject({ items: [] });
    await expect(
      gateway.list("00000000-0000-4000-8000-000000000002"),
    ).rejects.toThrow(/Organization/);
    request.mockResolvedValue({
      organizationId: org,
      items: ["unsafe"],
      nextCursor: null,
    });
    await expect(gateway.list(org)).rejects.toThrow();
  });
  it("validates job identifiers and bounded content queries", async () => {
    const request = vi.fn();
    const gateway = new SupportDiagnosticsGateway(request as never);
    await expect(gateway.read(org, "bad")).rejects.toThrow();
    await expect(
      gateway.content(org, org, { section: "logs", offset: 0, limit: 101 }),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

import {
  diagnosticOrg,
  diagnosticId,
  diagnosticKey,
  diagnosticSelection,
  diagnosticPreview,
  diagnosticJob,
  diagnosticContent,
} from "./diagnostic.fixture";
const mutation = { expectedVersion: 1, idempotencyKey: diagnosticKey };
describe("diagnostic gateway wire operations", () => {
  it("uses parsed bodies for preview/create/cancel/cleanup and POST review", async () => {
    const request = vi.fn().mockResolvedValue(diagnosticPreview);
    const gateway = new SupportDiagnosticsGateway(request as never);
    await expect(
      gateway.preview(diagnosticOrg, diagnosticSelection),
    ).resolves.toEqual(diagnosticPreview);
    expect(request.mock.lastCall![0]).toMatchObject({
      method: "POST",
      body: diagnosticSelection,
      path: "/api/v1/system/diagnostics/preview",
    });
    request.mockResolvedValue(diagnosticJob);
    await gateway.create(diagnosticOrg, {
      previewToken: "opaque",
      consent: true,
      idempotencyKey: diagnosticKey,
    });
    await gateway.read(diagnosticOrg, diagnosticId);
    await gateway.cancel(diagnosticOrg, diagnosticId, mutation);
    await gateway.cleanup(diagnosticOrg, diagnosticId, {
      ...mutation,
      reviewFingerprint: "a".repeat(64),
    });
    request.mockResolvedValue({
      organizationId: diagnosticOrg,
      jobId: diagnosticId,
      eligible: true,
      blockers: [],
      reviewFingerprint: "a".repeat(64),
    });
    await gateway.reviewCleanup(diagnosticOrg, diagnosticId);
    expect(request.mock.lastCall![0]).toMatchObject({
      method: "POST",
      path: `/api/v1/system/diagnostics/bundles/${diagnosticId}/cleanup-review`,
    });
    request.mockResolvedValue({
      organizationId: diagnosticOrg,
      jobId: diagnosticKey,
      eligible: true,
      blockers: [],
      reviewFingerprint: "a".repeat(64),
    });
    await expect(
      gateway.reviewCleanup(diagnosticOrg, diagnosticId),
    ).rejects.toThrow(/changed/);
  });
  it("bounds paginated content and verifies artifact/job/download path identity", async () => {
    const request = vi.fn().mockResolvedValue(diagnosticContent);
    const gateway = new SupportDiagnosticsGateway(request as never);
    await expect(
      gateway.content(diagnosticOrg, diagnosticId, {
        section: "logs",
        offset: 0,
        limit: 100,
      }),
    ).resolves.toEqual(diagnosticContent);
    request.mockResolvedValue({ ...diagnosticContent, jobId: diagnosticKey });
    await expect(
      gateway.content(diagnosticOrg, diagnosticId, {
        section: "logs",
        offset: 0,
        limit: 100,
      }),
    ).rejects.toThrow(/changed/);
    request.mockResolvedValue({
      ...diagnosticContent,
      section: "metrics",
      data: [],
    });
    await expect(
      gateway.content(diagnosticOrg, diagnosticId, {
        section: "logs",
        offset: 0,
        limit: 100,
      }),
    ).rejects.toThrow(/changed/);
    const grant = {
      organizationId: diagnosticOrg,
      jobId: diagnosticId,
      grantId: diagnosticKey,
      downloadPath: `/api/v1/system/diagnostics/bundles/${diagnosticId}/download/${diagnosticKey}`,
      expiresAt: diagnosticSelection.to,
    };
    request.mockResolvedValue(grant);
    await expect(
      gateway.grant(diagnosticOrg, diagnosticId, mutation),
    ).resolves.toEqual(grant);
    request.mockResolvedValue({ ...grant, jobId: diagnosticKey });
    await expect(
      gateway.grant(diagnosticOrg, diagnosticId, mutation),
    ).rejects.toThrow(/path/);
    request.mockResolvedValue({
      ...grant,
      downloadPath: `/api/v1/system/diagnostics/bundles/${diagnosticKey}/download/${diagnosticKey}`,
    });
    await expect(
      gateway.grant(diagnosticOrg, diagnosticId, mutation),
    ).rejects.toThrow(/path/);
    request.mockResolvedValue({
      organizationId: diagnosticOrg,
      items: [],
      nextCursor: diagnosticKey,
    });
    await gateway.list(diagnosticOrg, diagnosticKey);
    expect(request.mock.lastCall![0].path).toContain(`cursor=${diagnosticKey}`);
  });
});

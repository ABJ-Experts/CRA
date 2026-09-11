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

import { ConnectorMappingSection } from "./connector-mapping-section";
import type { FieldAuthorityPolicy } from "../../_features/connectors/connectors.schemas";

const PROTECTED_POLICY: FieldAuthorityPolicy = {
  id: "55555555-5555-4555-8555-555555555555",
  connectorId: "11111111-1111-4111-8111-111111111111",
  entityType: "product",
  fieldName: "name",
  policyValue: "cra_authoritative",
  protected: true,
  protectedReason: "Regulated field",
  policyVersion: 1,
};

const PREVIEW = {
  wouldCreate: 1,
  wouldUpdate: 2,
  wouldBeIgnored: 0,
  wouldConflict: 0,
  previewDigest: "digest-1",
};

const preview = vi.fn().mockResolvedValue({ preview: PREVIEW });
const save = vi.fn().mockResolvedValue({ policy: PROTECTED_POLICY });

// `preview.data` is always populated so the tests isolate the "freshness"
// gate (`previewedFor` vs. the current draft) — the behaviour the ticket
// actually asks for — from whatever a real mutation hook's `data` timing is.
vi.mock("../../_features/connectors/connectors.queries", () => ({
  usePreviewMappingMutation: () => ({
    isPending: false,
    data: { preview: PREVIEW },
    mutateAsync: preview,
  }),
  useSaveMappingMutation: () => ({ isPending: false, mutateAsync: save }),
}));

describe("ConnectorMappingSection", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps Save disabled until a fresh preview matches the current draft", async () => {
    render(
      <ConnectorMappingSection
        connectorId="11111111-1111-4111-8111-111111111111"
        policies={[]}
        canEdit
        isOwner
      />,
    );
    fireEvent.change(screen.getByLabelText("Field name"), {
      target: { value: "name" },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Preview impact" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );

    // Editing the draft after a preview invalidates it again.
    fireEvent.change(screen.getByLabelText("Field name"), {
      target: { value: "code" },
    });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("submits the previewed policy and digest when Save is clicked", async () => {
    render(
      <ConnectorMappingSection
        connectorId="11111111-1111-4111-8111-111111111111"
        policies={[]}
        canEdit
        isOwner
      />,
    );
    fireEvent.change(screen.getByLabelText("Field name"), {
      target: { value: "name" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview impact" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: "product",
        fieldName: "name",
        policyValue: "cra_authoritative",
        previewDigest: PREVIEW.previewDigest,
      }),
    );
  });

  it("blocks a non-owner from setting external authority on a protected field", () => {
    render(
      <ConnectorMappingSection
        connectorId="11111111-1111-4111-8111-111111111111"
        policies={[PROTECTED_POLICY]}
        canEdit
        isOwner={false}
      />,
    );
    fireEvent.change(screen.getByLabelText("Field name"), {
      target: { value: "name" },
    });
    fireEvent.change(screen.getByLabelText("Authority policy"), {
      target: { value: "external_authoritative" },
    });
    expect(
      screen.getByText(
        "Only the organization owner can set external authority on a protected field, or unprotect it.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("allows the owner through the same protected-field change", async () => {
    render(
      <ConnectorMappingSection
        connectorId="11111111-1111-4111-8111-111111111111"
        policies={[PROTECTED_POLICY]}
        canEdit
        isOwner
      />,
    );
    fireEvent.change(screen.getByLabelText("Field name"), {
      target: { value: "name" },
    });
    fireEvent.change(screen.getByLabelText("Authority policy"), {
      target: { value: "external_authoritative" },
    });
    expect(
      screen.queryByText(
        "Only the organization owner can set external authority on a protected field, or unprotect it.",
      ),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Preview impact" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" })).toBeEnabled(),
    );
  });
});

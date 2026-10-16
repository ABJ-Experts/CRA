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
import { ConnectorFieldMapSection } from "./connector-field-map-section";
const state = vi.hoisted(() => ({
  mapping: {
    revision: 2,
    fields: [
      {
        entityType: "product",
        sourceField: "name",
        targetField: "name",
        transform: "identity",
      },
    ],
  },
  schema: {
    schemaDigest: "a".repeat(64),
    mappingVersion: "v1",
    sources: [
      {
        entityType: "product",
        fields: [
          { field: "name", type: "string", nullable: false, sensitive: false },
        ],
      },
    ],
    targets: [
      {
        entityType: "product",
        fields: [
          { field: "name", type: "string", nullable: false, required: true },
        ],
      },
    ],
  },
  pending: false,
  error: false,
  preview: vi.fn(),
  save: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("../../_features/connectors/sync-operations.queries", () => ({
  useFieldMapQuery: () => ({
    data: { mapping: state.mapping },
    isPending: state.pending,
    isError: state.error,
    refetch: state.refetch,
  }),
  useFieldMapSchemaQuery: () => ({
    data: { schema: state.schema },
    isPending: state.pending,
    isError: state.error,
    refetch: state.refetch,
  }),
  usePreviewFieldMapMutation: () => ({
    mutateAsync: state.preview,
    isPending: false,
  }),
  useSaveFieldMapMutation: () => ({
    mutateAsync: state.save,
    isPending: false,
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.pending = false;
  state.error = false;
});
describe("validated source field mapping", () => {
  it("keeps forbidden configuration read-only", () => {
    render(
      <ConnectorFieldMapSection
        connectorId="connector"
        connectorVersion={3}
        canView={false}
        canEdit={false}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("permission");
    expect(
      screen.queryByRole("button", { name: "Save field mapping" }),
    ).not.toBeInTheDocument();
  });
  it("requires a fresh valid preview before saving a revision", async () => {
    state.preview.mockResolvedValue({
      preview: { valid: true, issues: [], samples: [], schema: state.schema },
    });
    state.save.mockResolvedValue({ mapping: state.mapping });
    render(
      <ConnectorFieldMapSection
        connectorId="connector"
        connectorVersion={3}
        canView
        canEdit
      />,
    );
    expect(
      screen.getByRole("button", { name: "Save field mapping" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Preview field mapping" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save field mapping" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save field mapping" }));
    await waitFor(() =>
      expect(state.save).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: 3,
          expectedMappingRevision: 2,
          schemaDigest: state.schema.schemaDigest,
        }),
      ),
    );
  });
  it("offers explicit recovery when discovery is unavailable", () => {
    state.error = true;
    render(
      <ConnectorFieldMapSection
        connectorId="connector"
        connectorVersion={3}
        canView
        canEdit
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry mapping discovery" }),
    );
    expect(state.refetch).toHaveBeenCalled();
  });
});

describe("field map draft preservation", () => {
  it("edits explicit assignments and invalidates a preview", async () => {
    state.preview.mockResolvedValue({
      preview: {
        valid: true,
        issues: [],
        samples: [
          {
            entityType: "product",
            externalId: "record",
            fields: { name: "safe" },
          },
        ],
        schema: state.schema,
      },
    });
    const { rerender } = render(
      <ConnectorFieldMapSection
        connectorId="connector"
        connectorVersion={3}
        canView
        canEdit
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Remove assignment 1" }),
    );
    expect(
      screen.getByText(/No explicit field assignments/),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Map product.name (required)" }),
    );
    fireEvent.change(screen.getByRole("combobox", { name: "Source field 1" }), {
      target: { value: "name" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preview field mapping" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/record:/)).toBeInTheDocument(),
    );
    rerender(
      <ConnectorFieldMapSection
        connectorId="connector"
        connectorVersion={4}
        canView
        canEdit
      />,
    );
    expect(
      screen.getByRole("button", { name: "Save field mapping" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Reapply draft to current revision" }),
    );
    expect(
      screen.getByRole("button", { name: "Save field mapping" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Discard field mapping draft" }),
    );
    expect(
      screen.queryByRole("button", { name: "Discard field mapping draft" }),
    ).not.toBeInTheDocument();
  });
  it("retains a non-secret draft after preview or save failure", async () => {
    state.preview.mockRejectedValueOnce(new Error("secret-canary"));
    render(
      <ConnectorFieldMapSection
        connectorId="connector"
        connectorVersion={3}
        canView
        canEdit
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview field mapping" }),
    );
    await waitFor(() =>
      expect(
        screen.getByText("Mapping preview could not be loaded."),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("secret-canary")).not.toBeInTheDocument();
    state.preview.mockResolvedValue({
      preview: { valid: true, issues: [], samples: [], schema: state.schema },
    });
    state.save.mockRejectedValueOnce(new Error("outage"));
    fireEvent.click(
      screen.getByRole("button", { name: "Preview field mapping" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save field mapping" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save field mapping" }));
    await waitFor(() =>
      expect(
        screen.getByText("The field mapping could not be saved."),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Discard field mapping draft" }),
    ).toBeInTheDocument();
  });
  it("blocks saving invalid mapped records and shows safe record errors", async () => {
    state.preview.mockResolvedValue({
      preview: {
        valid: false,
        issues: [
          {
            recordId: "safe-id",
            message: "A required source value is missing.",
          },
        ],
        samples: [],
        schema: state.schema,
      },
    });
    render(
      <ConnectorFieldMapSection
        connectorId="connector"
        connectorVersion={3}
        canView
        canEdit
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Preview field mapping" }),
    );
    await waitFor(() =>
      expect(screen.getByText(/safe-id:/)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "Save field mapping" }),
    ).toBeDisabled();
  });
  it("supports loading and view-only mappings", () => {
    state.pending = true;
    const { rerender } = render(
      <ConnectorFieldMapSection
        connectorId="connector"
        connectorVersion={3}
        canView
        canEdit={false}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading");
    state.pending = false;
    rerender(
      <ConnectorFieldMapSection
        connectorId="connector"
        connectorVersion={3}
        canView
        canEdit={false}
      />,
    );
    expect(screen.getAllByText("name")).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Preview field mapping" }),
    ).not.toBeInTheDocument();
  });
});

it("shows renamed sources as unavailable instead of silently selecting another field", () => {
  const original = state.mapping.fields[0]!.sourceField;
  state.mapping.fields[0]!.sourceField = "renamed_source";
  render(
    <ConnectorFieldMapSection
      connectorId="connector"
      connectorVersion={3}
      canView
      canEdit
    />,
  );
  expect(screen.getByRole("combobox", { name: "Source field 1" })).toHaveValue(
    "renamed_source",
  );
  expect(
    screen.getByText("renamed_source (unavailable; review required)"),
  ).toBeInTheDocument();
  state.mapping.fields[0]!.sourceField = original;
});

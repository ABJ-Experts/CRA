// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PRODUCT_CLASSIFICATION_POLICY } from "@repo/contracts/products";
import { ProductClassificationPanel } from "./product-classification-panel";
import { ApiClientError } from "../../_lib/http/api-client";
const state = vi.hoisted(() => ({
  data: undefined as unknown,
  pending: false,
  error: false,
  refetch: vi.fn(),
  save: vi.fn(),
}));
vi.mock("./product-classification.queries", () => ({
  useProductClassificationHistory: () => ({
    data: state.data,
    isPending: state.pending,
    isError: state.error,
    refetch: state.refetch,
  }),
}));
vi.mock("./product-classification.api", () => ({
  productClassificationApi: { save: state.save },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  state.pending = false;
  state.error = false;
});
function ready() {
  state.data = {
    policy: PRODUCT_CLASSIFICATION_POLICY,
    productVersion: 2,
    latest: null,
    runs: { rows: [], page: 1, pageSize: 15, pageCount: 2, total: 0 },
  };
}
const id = "11111111-1111-4111-8111-111111111111";
describe("classification panel", () => {
  it("shows loading and read failure retry", () => {
    state.pending = true;
    const { rerender } = render(
      <ProductClassificationPanel productId={id} canEdit />,
    );
    expect(screen.getByText("Loading classification…")).toBeInTheDocument();
    state.pending = false;
    state.error = true;
    rerender(<ProductClassificationPanel productId={id} canEdit />);
    fireEvent.click(
      screen.getByRole("button", { name: "Retry classification" }),
    );
    expect(state.refetch).toHaveBeenCalled();
  });
  it("branches with provisional live result and clears hidden answers", () => {
    ready();
    render(<ProductClassificationPanel productId={id} canEdit />);
    fireEvent.change(screen.getByLabelText(/Have you determined/), {
      target: { value: "in_scope" },
    });
    fireEvent.change(screen.getByLabelText(/critical product category/), {
      target: { value: "no" },
    });
    fireEvent.change(screen.getByLabelText(/Class II category/), {
      target: { value: "no" },
    });
    fireEvent.change(screen.getByLabelText(/Class I category/), {
      target: { value: "yes" },
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Provisional: Important Class I",
    );
    fireEvent.change(screen.getByLabelText(/critical product category/), {
      target: { value: "yes" },
    });
    expect(screen.queryByLabelText(/Class I category/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Provisional: Critical",
    );
  });
  it("preserves draft and idempotency on manual network retry", async () => {
    ready();
    state.save
      .mockRejectedValueOnce(new ApiClientError("network", "Offline"))
      .mockResolvedValue({ run: { revision: 1 } });
    render(<ProductClassificationPanel productId={id} canEdit />);
    fireEvent.change(screen.getByLabelText("Classification rationale"), {
      target: { value: "<script>plain text</script>" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Classification rationale")).toHaveValue(
      "<script>plain text</script>",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
    expect(state.save.mock.calls[0]?.[1].idempotencyKey).toEqual(
      state.save.mock.calls[1]?.[1].idempotencyKey,
    );
  });
  it("blocks conflict until explicit refresh and preserves rationale", async () => {
    ready();
    state.save.mockRejectedValue(new ApiClientError("api", "Conflict", 409));
    state.refetch.mockResolvedValue({ data: state.data });
    render(<ProductClassificationPanel productId={id} canEdit />);
    fireEvent.change(screen.getByLabelText("Classification rationale"), {
      target: { value: "Keep draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    await screen.findByRole("alert");
    expect(
      screen.getByRole("button", { name: "Save classification" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh classification revision" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Save classification" }),
      ).toBeEnabled(),
    );
    expect(screen.getByLabelText("Classification rationale")).toHaveValue(
      "Keep draft",
    );
  });
  it("requires rationale and hides all write actions for reader", () => {
    ready();
    const { rerender } = render(
      <ProductClassificationPanel productId={id} canEdit />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent("rationale");
    expect(state.save).not.toHaveBeenCalled();
    rerender(<ProductClassificationPanel productId={id} canEdit={false} />);
    expect(
      screen.queryByRole("button", { name: "Save classification" }),
    ).toBeNull();
    expect(
      screen.getByText("No classification runs recorded."),
    ).toBeInTheDocument();
  });
  it("renders immutable escaped history and pagination, showing changed product", () => {
    ready();
    const answers = {
      scope: "undetermined",
      criticalCoreFunction: null,
      classIICoreFunction: null,
      classICoreFunction: null,
    };
    const run = {
      id,
      revision: 1,
      productVersion: 1,
      classification: "undetermined",
      answers,
      rationale: "<img src=x onerror=evil()>",
      createdAt: "2026-09-28T00:00:00Z",
      policySnapshot: PRODUCT_CLASSIFICATION_POLICY,
    };
    state.data = {
      policy: PRODUCT_CLASSIFICATION_POLICY,
      productVersion: 2,
      latest: run,
      runs: { rows: [run, { ...run, id: "older", revision: 0 }], pageCount: 2 },
    };
    const { container } = render(
      <ProductClassificationPanel productId={id} canEdit={false} />,
    );
    expect(
      screen.getByText(/Product changed since this run/),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getAllByText("<img src=x onerror=evil()>")).toHaveLength(2);
    fireEvent.click(
      screen.getByRole("button", { name: "Next classification runs" }),
    );
    expect(
      screen.getByRole("button", { name: "Previous classification runs" }),
    ).toBeEnabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Previous classification runs" }),
    );
  });
  it.each([
    [403, "permission"],
    [404, "unavailable"],
  ])(
    "reports scoped denial %s without losing answers",
    async (status, text) => {
      ready();
      state.save.mockRejectedValue(
        new ApiClientError("api", "Denied", status as number),
      );
      const dirty = vi.fn();
      render(
        <ProductClassificationPanel
          productId={id}
          canEdit
          onDirtyChange={dirty}
        />,
      );
      fireEvent.change(screen.getByLabelText("Classification rationale"), {
        target: { value: "Draft" },
      });
      fireEvent.click(
        screen.getByRole("button", { name: "Save classification" }),
      );
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(String(text)),
      );
      expect(dirty).toHaveBeenCalledWith(true);
    },
  );
  it("retains conflict when refresh fails, then requires confirmation on current version", async () => {
    ready();
    state.save.mockRejectedValue(new ApiClientError("api", "Conflict", 409));
    state.refetch
      .mockResolvedValueOnce({ error: new Error("Offline") })
      .mockRejectedValueOnce(new Error("Offline"));
    render(<ProductClassificationPanel productId={id} canEdit />);
    fireEvent.change(screen.getByLabelText("Classification rationale"), {
      target: { value: "Draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh classification revision" }),
    );
    await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(1));
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh classification revision" }),
    );
    await waitFor(() => expect(state.refetch).toHaveBeenCalledTimes(2));
    expect(
      screen.getByRole("button", { name: "Save classification" }),
    ).toBeDisabled();
  });
  it("shows Class II and out-of-scope branches while rotating edited retry", async () => {
    ready();
    state.save.mockRejectedValue(new Error("Offline"));
    render(<ProductClassificationPanel productId={id} canEdit />);
    fireEvent.change(screen.getByLabelText(/Have you determined/), {
      target: { value: "in_scope" },
    });
    fireEvent.change(screen.getByLabelText(/critical product category/), {
      target: { value: "no" },
    });
    fireEvent.change(screen.getByLabelText(/Class II category/), {
      target: { value: "yes" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Important Class II");
    fireEvent.change(screen.getByLabelText(/Have you determined/), {
      target: { value: "out_of_scope" },
    });
    expect(screen.getByRole("status")).toHaveTextContent("Out of scope");
    fireEvent.change(screen.getByLabelText("Classification rationale"), {
      target: { value: "Draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("Classification rationale"), {
      target: { value: "Changed" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2));
    expect(state.save.mock.calls[0]?.[1].idempotencyKey).not.toEqual(
      state.save.mock.calls[1]?.[1].idempotencyKey,
    );
  });
  it("editing answers or rationale never bypasses explicit conflict refresh", async () => {
    ready();
    state.save.mockRejectedValue(new ApiClientError("api", "Conflict", 409));
    render(<ProductClassificationPanel productId={id} canEdit />);
    fireEvent.change(screen.getByLabelText("Classification rationale"), {
      target: { value: "Draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("Classification rationale"), {
      target: { value: "Edited draft" },
    });
    expect(
      screen.getByRole("button", { name: "Save classification" }),
    ).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Have you determined/), {
      target: { value: "out_of_scope" },
    });
    expect(
      screen.getByRole("button", { name: "Save classification" }),
    ).toBeDisabled();
  });
  it("pins product and classification revisions while unsaved draft is edited", async () => {
    ready();
    state.save.mockRejectedValue(new Error("Offline"));
    const { rerender } = render(
      <ProductClassificationPanel productId={id} canEdit />,
    );
    fireEvent.change(screen.getByLabelText("Classification rationale"), {
      target: { value: "Draft" },
    });
    state.data = {
      policy: PRODUCT_CLASSIFICATION_POLICY,
      productVersion: 9,
      latest: { revision: 3 },
      runs: { rows: [], pageCount: 1 },
    };
    rerender(<ProductClassificationPanel productId={id} canEdit />);
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    expect(state.save.mock.calls[0]?.[1]).toMatchObject({
      expectedProductVersion: 2,
      expectedRevision: 0,
    });
  });
  it("never clears conflict using stale data returned by a failed refresh", async () => {
    ready();
    state.save.mockRejectedValue(new ApiClientError("api", "Conflict", 409));
    state.refetch.mockResolvedValue({
      data: state.data,
      isError: true,
      error: new Error("Offline"),
    });
    render(<ProductClassificationPanel productId={id} canEdit />);
    fireEvent.change(screen.getByLabelText("Classification rationale"), {
      target: { value: "Draft" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    await screen.findByRole("alert");
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh classification revision" }),
    );
    await waitFor(() => expect(state.refetch).toHaveBeenCalled());
    expect(
      screen.getByRole("button", { name: "Save classification" }),
    ).toBeDisabled();
  });
  it("shows every immutable saved answer using exact historical question prompts, escaping text", () => {
    ready();
    const historicalPolicy = {
      ...PRODUCT_CLASSIFICATION_POLICY,
      version: "historical-questionnaire-v1",
      questions: PRODUCT_CLASSIFICATION_POLICY.questions.map((question) => ({
        ...question,
        prompt: `Saved ${question.key}: <img src=x onerror=evil()>`,
      })),
    };
    const run = {
      id,
      revision: 1,
      productVersion: 2,
      classification: "important_class_ii",
      answers: {
        scope: "in_scope",
        criticalCoreFunction: "no",
        classIICoreFunction: "yes",
        classICoreFunction: null,
      },
      rationale: "Historical declaration",
      createdAt: "2026-09-28T00:00:00Z",
      policySnapshot: historicalPolicy,
    };
    state.data = {
      policy: PRODUCT_CLASSIFICATION_POLICY,
      productVersion: 2,
      latest: run,
      runs: { rows: [run], pageCount: 1 },
    };
    const { container } = render(
      <ProductClassificationPanel productId={id} canEdit={false} />,
    );
    const history = within(
      screen.getByRole("list", { name: "Classification runs" }),
    );
    for (const question of historicalPolicy.questions)
      expect(history.getByText(question.prompt)).toBeInTheDocument();
    expect(history.getByText("In scope")).toBeInTheDocument();
    expect(history.getByText("No")).toBeInTheDocument();
    expect(history.getByText("Yes")).toBeInTheDocument();
    expect(history.getByText("Skipped")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
  it("uses live latest and product version for history labels while keeping draft revisions pinned", async () => {
    const oldRun = {
      id,
      revision: 1,
      productVersion: 1,
      classification: "undetermined",
      answers: {
        scope: "undetermined",
        criticalCoreFunction: null,
        classIICoreFunction: null,
        classICoreFunction: null,
      },
      rationale: "Old decision",
      createdAt: "2026-09-28T00:00:00Z",
      policySnapshot: PRODUCT_CLASSIFICATION_POLICY,
    };
    state.data = {
      policy: PRODUCT_CLASSIFICATION_POLICY,
      productVersion: 1,
      latest: oldRun,
      runs: { rows: [oldRun], pageCount: 1 },
    };
    state.save.mockRejectedValue(new Error("Offline"));
    const { rerender } = render(
      <ProductClassificationPanel productId={id} canEdit />,
    );
    fireEvent.change(screen.getByLabelText("Classification rationale"), {
      target: { value: "My preserved draft" },
    });
    const newRun = {
      ...oldRun,
      id: "newer-run",
      revision: 2,
      productVersion: 3,
      classification: "critical",
      answers: {
        scope: "in_scope",
        criticalCoreFunction: "yes",
        classIICoreFunction: null,
        classICoreFunction: null,
      },
      rationale: "New decision",
    };
    state.data = {
      policy: PRODUCT_CLASSIFICATION_POLICY,
      productVersion: 3,
      latest: newRun,
      runs: { rows: [newRun, oldRun], pageCount: 1 },
    };
    rerender(<ProductClassificationPanel productId={id} canEdit />);
    const history = within(
      screen.getByRole("list", { name: "Classification runs" }),
    );
    expect(
      history.getByText("Provisional: Critical · Latest"),
    ).toBeInTheDocument();
    expect(
      history.getByText("Provisional: Undetermined · Superseded"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Product changed since this run."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Latest: Provisional: Critical"),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Save classification" }),
    );
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(1));
    expect(state.save.mock.calls[0]?.[1]).toMatchObject({
      expectedProductVersion: 1,
      expectedRevision: 1,
    });
  });
});

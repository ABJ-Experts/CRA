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
import { ProductCreateForm } from "./products-registry-content";
import { ReleaseCreateForm } from "./product-detail-content";
import type {
  CreateProductInput,
  CreateReleaseInput,
} from "@repo/contracts/products";
const mocks = vi.hoisted(() => ({ product: vi.fn(), release: vi.fn() }));
vi.mock("../../_features/products/products.queries", () => ({
  useCreateProductMutation: () => ({
    isPending: false,
    mutateAsync: mocks.product,
  }),
  useCreateReleaseMutation: () => ({
    isPending: false,
    mutateAsync: mocks.release,
  }),
}));
vi.mock("../../_features/products/product-owner-selector", () => ({
  ProductOwnerSelector: () => <span>Owner</span>,
}));
afterEach(cleanup);
beforeEach(() => {
  mocks.product.mockReset();
  mocks.release.mockReset();
});
const id = "11111111-1111-4111-8111-111111111111";
function fillProduct() {
  fireEvent.change(screen.getByLabelText("Product name"), {
    target: { value: "Sentinel" },
  });
  fireEvent.change(screen.getByLabelText("Internal code"), {
    target: { value: "CRA-001" },
  });
}
function fillRelease() {
  fireEvent.change(screen.getByLabelText("Release label"), {
    target: { value: "Stable" },
  });
  fireEvent.change(screen.getByLabelText("Version"), {
    target: { value: "1.0" },
  });
}
describe("product command retries", () => {
  it("reuses the key after failed response and rotates after parsed payload changes and success", async () => {
    mocks.product
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({ product: { id } });
    render(
      <ProductCreateForm
        ownerId={id}
        legalEntities={[
          {
            id,
            displayName: "Entity",
            status: "active",
            completionStatus: "complete",
          },
        ]}
        onCreated={vi.fn()}
      />,
    );
    fillProduct();
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await screen.findByText("The product could not be created.");
    fireEvent.change(screen.getByLabelText("Product name"), {
      target: { value: " Sentinel " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await waitFor(() => expect(mocks.product).toHaveBeenCalledTimes(2));
    const first = mocks.product.mock.calls[0]?.[0] as CreateProductInput;
    expect(mocks.product.mock.calls[1]?.[0].idempotencyKey).toBe(
      first.idempotencyKey,
    );
    expect(screen.getByLabelText("Internal code")).toHaveValue("CRA-001");
    fireEvent.change(screen.getByLabelText("Internal code"), {
      target: { value: "CRA-002" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await waitFor(() => expect(mocks.product).toHaveBeenCalledTimes(3));
    expect(mocks.product.mock.calls[2]?.[0].idempotencyKey).not.toBe(
      first.idempotencyKey,
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Create product" }),
      ).toBeEnabled(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create product" }));
    await waitFor(() => expect(mocks.product).toHaveBeenCalledTimes(4));
    expect(mocks.product.mock.calls[3]?.[0].idempotencyKey).not.toBe(
      mocks.product.mock.calls[2]?.[0].idempotencyKey,
    );
  });
  it("reuses release key on retry, rotates on edit, and resets after success", async () => {
    mocks.release
      .mockRejectedValueOnce(new Error("Lost response"))
      .mockRejectedValueOnce(new Error("Offline"))
      .mockResolvedValue({});
    render(<ReleaseCreateForm productId={id} />);
    fillRelease();
    fireEvent.click(screen.getByRole("button", { name: "Add release" }));
    await screen.findByText("The release could not be created.");
    fireEvent.click(screen.getByRole("button", { name: "Add release" }));
    await waitFor(() => expect(mocks.release).toHaveBeenCalledTimes(2));
    const first = mocks.release.mock.calls[0]?.[0] as CreateReleaseInput;
    expect(mocks.release.mock.calls[1]?.[0].idempotencyKey).toBe(
      first.idempotencyKey,
    );
    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "1.1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add release" }));
    await screen.findByText("Release created.");
    expect(mocks.release.mock.calls[2]?.[0].idempotencyKey).not.toBe(
      first.idempotencyKey,
    );
    fillRelease();
    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "1.1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add release" }));
    await waitFor(() => expect(mocks.release).toHaveBeenCalledTimes(4));
    expect(mocks.release.mock.calls[3]?.[0].idempotencyKey).not.toBe(
      mocks.release.mock.calls[2]?.[0].idempotencyKey,
    );
  });
});

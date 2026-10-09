// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import type { LegalEntity } from "@repo/contracts";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationLegalEntitiesSection } from "./organization-legal-entities-section";

const mutations = vi.hoisted(() => ({
  create: { mutateAsync: vi.fn(), isPending: false },
  update: { mutateAsync: vi.fn(), isPending: false },
  transition: { mutateAsync: vi.fn(), isPending: false },
}));

vi.mock("../../_features/organizations/organizations.queries", () => ({
  useCreateLegalEntityMutation: () => mutations.create,
  useUpdateLegalEntityMutation: () => mutations.update,
  useTransitionLegalEntityMutation: () => mutations.transition,
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const BASE_ENTITY = {
  id: "33333333-3333-4333-8333-333333333333",
  organizationId: ORGANIZATION_ID,
  identifier: "analytical-engines-gb",
  displayName: "Analytical Engines UK",
  legalName: "Analytical Engines Ltd",
  registeredAddress: {
    addressLine1: "1 Engine Way",
    locality: "London",
    postalCode: "SW1A 1AA",
    country: "GB",
  },
  mainEstablishmentCountry: "GB",
  phone: "+442079460000",
  registrationIdentifier: "GB123456",
  taxIdentifier: "VAT987654",
  manufacturerContactName: "Ada Lovelace",
  manufacturerContactEmail: "ada@example.test",
  status: "active",
  completionStatus: "complete",
  isDefault: true,
  version: 2,
  dependencyProjections: [{ kind: "product", count: 1 }],
  createdAt: "2026-08-10T10:00:00.000Z",
  updatedAt: "2026-08-10T10:00:00.000Z",
  createdBy: ACTOR_ID,
  updatedBy: ACTOR_ID,
  deletedAt: null,
} as const satisfies LegalEntity;

const INCOMPLETE_ENTITY = {
  id: "44444444-4444-4444-8444-444444444444",
  organizationId: ORGANIZATION_ID,
  identifier: null,
  displayName: "Legacy legal profile",
  legalName: null,
  registeredAddress: null,
  mainEstablishmentCountry: null,
  phone: null,
  registrationIdentifier: null,
  taxIdentifier: null,
  manufacturerContactName: null,
  manufacturerContactEmail: null,
  status: "inactive",
  completionStatus: "needs_completion",
  isDefault: false,
  version: 0,
  dependencyProjections: [],
  createdAt: "2026-08-10T10:00:00.000Z",
  updatedAt: "2026-08-10T10:00:00.000Z",
  createdBy: ACTOR_ID,
  updatedBy: ACTOR_ID,
  deletedAt: null,
} as const satisfies LegalEntity;

const INACTIVE_COMPLETE_ENTITY = {
  ...BASE_ENTITY,
  id: "55555555-5555-4555-8555-555555555555",
  displayName: "Analytical Engines EU",
  status: "inactive",
  version: 4,
  dependencyProjections: [{ kind: "report", count: 2 }],
} as const satisfies LegalEntity;

const DELETED_ENTITY = {
  ...BASE_ENTITY,
  id: "66666666-6666-4666-8666-666666666666",
  displayName: "Retired entity",
  status: "deleted",
  deletedAt: "2026-08-11T10:00:00.000Z",
  version: 5,
} as const satisfies LegalEntity;

function renderSection({
  legalEntities = [
    BASE_ENTITY,
    INCOMPLETE_ENTITY,
    INACTIVE_COMPLETE_ENTITY,
    DELETED_ENTITY,
  ],
  canManage = true,
}: Partial<React.ComponentProps<typeof OrganizationLegalEntitiesSection>> = {}) {
  const onRefresh = vi.fn();
  render(
    <OrganizationLegalEntitiesSection
      legalEntities={legalEntities}
      canManage={canManage}
      onRefresh={onRefresh}
    />,
  );
  return { onRefresh };
}

function completeNewEntityForm() {
  fireEvent.change(screen.getByLabelText("Entity identifier"), {
    target: { value: "analytical-engines-us" },
  });
  fireEvent.change(screen.getByLabelText("Display name"), {
    target: { value: "Analytical Engines US" },
  });
  fireEvent.change(screen.getByLabelText("Legal name"), {
    target: { value: "Analytical Engines LLC" },
  });
  fireEvent.change(screen.getByLabelText("Main establishment country"), {
    target: { value: "US" },
  });
  fireEvent.change(screen.getByLabelText("Manufacturer contact name"), {
    target: { value: "Grace Hopper" },
  });
  fireEvent.change(screen.getByLabelText("Manufacturer contact email"), {
    target: { value: "grace@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Address line 1"), {
    target: { value: "1 Compiler Road" },
  });
  fireEvent.change(screen.getByLabelText("Locality"), {
    target: { value: "New York" },
  });
  fireEvent.change(screen.getByLabelText("Postal code"), {
    target: { value: "10001" },
  });
  fireEvent.change(screen.getByLabelText("Phone"), {
    target: { value: " +12125550123 " },
  });
  fireEvent.change(screen.getByLabelText("Registration identifier"), {
    target: { value: " US-123 " },
  });
  fireEvent.change(screen.getByLabelText("Tax identifier"), {
    target: { value: " US-TAX-456 " },
  });
  fireEvent.change(screen.getByLabelText("Address line 2"), {
    target: { value: " Suite 101 " },
  });
  fireEvent.change(screen.getByLabelText("State, province, or region"), {
    target: { value: " NY " },
  });
  fireEvent.change(screen.getByLabelText("Registered address country"), {
    target: { value: "US" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mutations.create.mutateAsync.mockResolvedValue({ legalEntity: BASE_ENTITY });
  mutations.update.mutateAsync.mockResolvedValue({ legalEntity: BASE_ENTITY });
  mutations.transition.mutateAsync.mockResolvedValue({ legalEntity: BASE_ENTITY });
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
    "77777777-7777-4777-8777-777777777777",
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("OrganizationLegalEntitiesSection", () => {
  it("shows dependency totals and lifecycle restrictions without mutation controls to viewers", () => {
    renderSection({ canManage: false });

    expect(screen.getAllByText("1 dependent record")).toHaveLength(2);
    expect(screen.getByText("2 dependent records")).toBeInTheDocument();
    expect(screen.getAllByText("Not assigned")).toHaveLength(1);
    expect(screen.getAllByText("Not recorded")).toHaveLength(2);
    expect(
      screen.getByText(/only organization owners with edit permission/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Edit Analytical Engines UK/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Create legal entity" }),
    ).not.toBeInTheDocument();
  });

  it("creates a new entity with blank optional values omitted from the request", async () => {
    const { onRefresh } = renderSection({ legalEntities: [] });
    completeNewEntityForm();
    fireEvent.click(screen.getByRole("button", { name: "Create legal entity" }));

    await waitFor(() =>
      expect(mutations.create.mutateAsync).toHaveBeenCalledWith({
        identifier: "analytical-engines-us",
        displayName: "Analytical Engines US",
        legalName: "Analytical Engines LLC",
        registeredAddress: {
          addressLine1: "1 Compiler Road",
          addressLine2: "Suite 101",
          locality: "New York",
          administrativeArea: "NY",
          postalCode: "10001",
          country: "US",
        },
        mainEstablishmentCountry: "US",
        phone: "+12125550123",
        registrationIdentifier: "US-123",
        taxIdentifier: "US-TAX-456",
        manufacturerContactName: "Grace Hopper",
        manufacturerContactEmail: "grace@example.test",
        idempotencyKey: "77777777-7777-4777-8777-777777777777",
      }),
    );
    expect(await screen.findByText("Legal entity created.")).toBeInTheDocument();
    expect(screen.getByLabelText("Entity identifier")).toHaveValue("");
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("keeps the editor usable when create and lifecycle calls fail", async () => {
    mutations.create.mutateAsync.mockRejectedValue(new Error("network"));
    mutations.transition.mutateAsync.mockRejectedValue(new Error("network"));
    renderSection();

    completeNewEntityForm();
    fireEvent.click(screen.getByRole("button", { name: "Create legal entity" }));
    expect(
      await screen.findByText("Legal entity could not be saved."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Entity identifier")).toHaveValue(
      "analytical-engines-us",
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Activate Analytical Engines EU" }),
    );
    await waitFor(() =>
      expect(mutations.transition.mutateAsync).toHaveBeenCalledWith({
        legalEntityId: INACTIVE_COMPLETE_ENTITY.id,
        input: { expectedVersion: 4, status: "active" },
      }),
    );
    expect(
      await screen.findByText("Legal entity status could not be changed."),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("Complete this entity before activation."),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Delete Retired entity" }),
    ).not.toBeInTheDocument();
  });

  it("prefills entity edits and restores a blank draft when the owner cancels", () => {
    renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit Analytical Engines UK" }),
    );
    expect(screen.getByLabelText("Phone")).toHaveValue("+442079460000");
    expect(screen.getByLabelText("Address line 2")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Save legal entity" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel edit" }));
    expect(screen.getByLabelText("Entity identifier")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Create legal entity" }),
    ).toBeInTheDocument();
  });
});

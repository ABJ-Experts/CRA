import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CreateOrganisationForm } from "./create-organisation-form";

const mocks = vi.hoisted(() => ({
  browserApi: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

vi.mock("../app/_lib/browser-api", () => ({
  browserApi: mocks.browserApi,
  jsonRequest: (body: unknown) => ({ method: "POST", body: JSON.stringify(body) }),
}));

describe("CreateOrganisationForm", () => {
  beforeEach(() => {
    mocks.browserApi.mockReset();
    mocks.push.mockReset();
    mocks.refresh.mockReset();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
  });

  it("creates and selects the first organisation before starting onboarding", async () => {
    mocks.browserApi.mockResolvedValue({ data: { id: "00000000-0000-7000-8000-000000000001" } });
    render(createElement(CreateOrganisationForm));

    fireEvent.change(screen.getByLabelText("Organisation name"), {
      target: { value: "ABJ Experts" },
    });
    fireEvent.change(screen.getByLabelText("Country of main establishment"), {
      target: { value: "de" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Create organisation" }).closest("form")!);

    await waitFor(() =>
      expect(mocks.browserApi).toHaveBeenCalledWith(
        "/organisations",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/auth/organisation",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/app/onboarding");
  });
});

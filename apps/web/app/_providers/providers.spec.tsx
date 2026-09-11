// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const worker = vi.hoisted(() => ({ start: vi.fn() }));

vi.mock("../../mocks/browser", () => ({ worker }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
});

async function loadProviders() {
  return import("./providers");
}

describe("Providers", () => {
  it("holds queries until the mock worker is ready", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "true");
    let release: (() => void) | undefined;
    worker.start.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const { Providers, useMocksReady } = await loadProviders();
    const Probe = () => (
      <output>{useMocksReady() ? "ready" : "waiting"}</output>
    );

    render(
      <Providers>
        <Probe />
      </Providers>,
    );
    expect(screen.getByText("waiting")).toBeVisible();
    await waitFor(() =>
      expect(worker.start).toHaveBeenCalledWith({
        onUnhandledRequest: "bypass",
        quiet: true,
        serviceWorker: { url: "/mockServiceWorker.js" },
      }),
    );

    release?.();
    expect(await screen.findByText("ready")).toBeVisible();
  });

  it("opens the readiness gate when service-worker startup fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "true");
    worker.start.mockRejectedValue(new Error("unsupported context"));
    const { Providers, useMocksReady } = await loadProviders();
    const Probe = () => (
      <output>{useMocksReady() ? "ready" : "waiting"}</output>
    );

    render(
      <Providers>
        <Probe />
      </Providers>,
    );

    expect(await screen.findByText("ready")).toBeVisible();
  });

  it("is immediately ready and skips worker startup for a real backend", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
    const { Providers, useMocksReady } = await loadProviders();
    const Probe = () => (
      <output>{useMocksReady() ? "ready" : "waiting"}</output>
    );

    render(
      <Providers>
        <Probe />
      </Providers>,
    );

    expect(screen.getByText("ready")).toBeVisible();
    expect(worker.start).not.toHaveBeenCalled();
  });

  it("does not publish worker readiness after unmount", async () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "true");
    let release: (() => void) | undefined;
    worker.start.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    const { Providers } = await loadProviders();
    const view = render(<Providers>content</Providers>);

    view.unmount();
    release?.();

    await waitFor(() => expect(view.container).toBeEmptyDOMElement());
  });
});

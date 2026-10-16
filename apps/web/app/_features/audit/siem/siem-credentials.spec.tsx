// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SiemCredentials } from "./siem-credentials";
afterEach(cleanup);
it("clears secret material after an ambiguous failure", async () => {
  const save = vi.fn().mockRejectedValue(new Error("offline"));
  render(<SiemCredentials pending={false} syslog={false} onSave={save} />);
  fireEvent.change(screen.getByLabelText("Bearer token"), {
    target: { value: "canary-secret" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Bearer token")).toHaveValue(""),
  );
  expect(save).toHaveBeenCalledWith({ mode: "bearer", token: "canary-secret" });
});
it("validates empty credentials and switches modes without carrying secrets", () => {
  render(<SiemCredentials pending={false} syslog={false} onSave={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }));
  expect(screen.getByRole("alert")).toHaveTextContent("valid credentials");
  fireEvent.change(screen.getByLabelText("Authentication"), {
    target: { value: "mtls" },
  });
  expect(screen.queryByLabelText("Bearer token")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Client private key")).toHaveValue("");
});
it("sends TLS client PEM fields and clears all inputs", async () => {
  const save = vi.fn().mockResolvedValue({});
  render(<SiemCredentials pending={false} syslog onSave={save} />);
  const pem = "-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----";
  for (const label of [
    "Client certificate",
    "Client private key",
    "Custom CA (optional)",
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value: pem } });
  fireEvent.click(screen.getByRole("button", { name: "Rotate credentials" }));
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith({
      mode: "mtls",
      certificate: pem,
      privateKey: pem,
      ca: pem,
    }),
  );
  expect(screen.getByLabelText("Client private key")).toHaveValue("");
});

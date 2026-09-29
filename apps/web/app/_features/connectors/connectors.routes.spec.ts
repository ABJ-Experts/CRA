import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectorsApi } from "./connectors.api";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
vi.mock("../../_lib/http/authenticated-request", () => ({
  authenticatedRequestJson: vi.fn().mockResolvedValue({}),
}));
const id = "11111111-1111-4111-8111-111111111111";
const run = "22222222-2222-4222-8222-222222222222";
const base = `/api/v1/connectors/${id}`;
const sync = `${base}/sync-runs/${run}`;
const api = new ConnectorsApi();

describe("connector gateway route and boundary regression", () => {
  afterEach(() => vi.clearAllMocks());
  const cases: [string, () => Promise<unknown>, string, string?][] = [
    [
      "field schema",
      () => api.fieldMapSchema(id),
      `${base}/field-mapping/schema`,
    ],
    ["field map", () => api.fieldMap(id), `${base}/field-mapping`],
    [
      "preview field map",
      () => api.previewFieldMap(id, { fields: [] }),
      `${base}/field-mapping/preview`,
      "POST",
    ],
    [
      "save field map",
      () => api.saveFieldMap(id, {} as never),
      `${base}/field-mapping`,
      "POST",
    ],
    [
      "history",
      () => api.syncHistory(id),
      `${base}/sync-history?page=1&pageSize=15`,
    ],
    [
      "history detail",
      () => api.syncDetail(id, run),
      `${sync}/history?page=1&pageSize=15`,
    ],
    [
      "dead letter records",
      () => api.deadLetterRecords(id),
      `${base}/dead-letter-records?page=1&pageSize=15`,
    ],
    [
      "preview replay",
      () => api.previewReplay(id, run, {} as never),
      `${sync}/replay/preview`,
      "POST",
    ],
    [
      "replay",
      () => api.replay(id, run, {} as never),
      `${sync}/replay`,
      "POST",
    ],
    [
      "list",
      () => api.list({ q: "reference" }),
      "/api/v1/connectors?q=reference",
    ],
    ["get", () => api.get(id), base],
    ["catalogue", () => api.catalogue(), "/api/v1/connectors/catalogue"],
    ["overviews", () => api.overviews(), "/api/v1/connectors/overview"],
    ["overview", () => api.overview(id), `${base}/overview`],
    ["create", () => api.create({} as never), "/api/v1/connectors", "POST"],
    ["update", () => api.update(id, {} as never), base, "PATCH"],
    [
      "setSecret",
      () => api.setSecret(id, {} as never),
      `${base}/secret`,
      "POST",
    ],
    ["test", () => api.test(id, {} as never), `${base}/test`, "POST"],
    [
      "revoke",
      () => api.revokeSecret(id, {} as never),
      `${base}/secret/revoke`,
      "POST",
    ],
    [
      "disconnect",
      () => api.disconnect(id, {} as never),
      `${base}/disconnect`,
      "POST",
    ],
    [
      "reconnect",
      () => api.reconnect(id, {} as never),
      `${base}/reconnect`,
      "POST",
    ],
    ["archive", () => api.archive(id, {} as never), `${base}/archive`, "POST"],
    ["getMapping", () => api.getMapping(id), `${base}/mapping`],
    [
      "previewMapping",
      () => api.previewMapping(id, {} as never),
      `${base}/mapping/preview`,
      "POST",
    ],
    [
      "saveMapping",
      () => api.saveMapping(id, {} as never),
      `${base}/mapping`,
      "POST",
    ],
    ["identities", () => api.listIdentities(id), `${base}/identities`],
    [
      "link",
      () => api.linkIdentity(id, {} as never),
      `${base}/identities/link`,
      "POST",
    ],
    [
      "unlink",
      () => api.unlinkIdentity(id, run, {} as never),
      `${base}/identities/${run}/unlink`,
      "POST",
    ],
    [
      "merge",
      () => api.mergeIdentities(id, {} as never),
      `${base}/identities/merge`,
      "POST",
    ],
    [
      "start",
      () => api.startSyncRun(id, {} as never),
      `${base}/sync-runs`,
      "POST",
    ],
    ["runs", () => api.listSyncRuns(id), `${base}/sync-runs`],
    ["run", () => api.getSyncRun(id, run), sync],
    ["plan", () => api.listPlanItems(id, run), `${sync}/plan-items`],
    [
      "requestCommit",
      () => api.requestCommit(id, run, {} as never),
      `${sync}/request-commit`,
      "POST",
    ],
    [
      "cancel",
      () => api.cancelSyncRun(id, run, {} as never),
      `${sync}/cancel`,
      "POST",
    ],
    ["retry", () => api.retrySyncRun(id, run), `${sync}/retry`, "POST"],
    ["runConflicts", () => api.listRunConflicts(id, run), `${sync}/conflicts`],
    [
      "conflict",
      () => api.getConflict(id),
      `/api/v1/connectors/conflicts/${id}`,
    ],
    [
      "resolve",
      () => api.resolveConflict(id, {} as never),
      `/api/v1/connectors/conflicts/${id}/resolve`,
      "POST",
    ],
    ["deadLetters", () => api.listDeadLetters(id), `${base}/dead-letters`],
    ["metrics", () => api.getMetricsSnapshot(id), `${base}/metrics-snapshot`],
    [
      "diagnostics",
      () => api.exportDiagnostics(id),
      `${base}/diagnostics/export`,
      "POST",
    ],
  ];
  it.each(cases)(
    "preserves %s route and runtime boundaries",
    async (_name, call, path, method) => {
      await call();
      const options = vi.mocked(authenticatedRequestJson).mock.calls[0]![0];
      expect(options.path).toBe(path);
      expect(typeof options.schema.parse).toBe("function");
      if (method) {
        expect(options.method).toBe(method);
        expect(typeof options.inputSchema?.parse).toBe("function");
      }
    },
  );
  it("rejects substituted invalid identifiers before transport", async () => {
    await expect(api.get("invalid")).rejects.toMatchObject({
      kind: "invalid_request",
    });
    await expect(api.getSyncRun(id, "invalid")).rejects.toMatchObject({
      kind: "invalid_request",
    });
    await expect(api.getConflict("invalid")).rejects.toMatchObject({
      kind: "invalid_request",
    });
    expect(authenticatedRequestJson).not.toHaveBeenCalled();
  });
});

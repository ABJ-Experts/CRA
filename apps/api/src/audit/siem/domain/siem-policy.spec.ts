import {
  projectSiemEvent,
  formatSiemEvent,
  frameSyslog,
  escapeCefHeader,
  escapeCefExtension,
  syslogMessage,
  siemCatalogue,
} from "./siem-policy";
const id = "fcd0e5e9-99ea-48c3-8327-c6be3176855c";
const raw = {
  id,
  organizationId: id,
  scope: "organization",
  createdAt: "2026-10-07T00:00:00Z",
  action: "audit.search.created",
  entityType: "audit_search",
  entityId: id,
  actorType: "user",
  actorId: id,
  correlationId: id,
  outcome: "completed",
  sequence: "9007199254740993",
  changes: { secret: "CANARY" },
};
describe("SIEM projection and encoding", () => {
  it("projects only structural fields and rejects non-tenant/unknown pairs", () => {
    const event = projectSiemEvent(id, raw);
    expect(event).not.toBeNull();
    expect(JSON.stringify(event)).not.toContain("CANARY");
    expect(projectSiemEvent(id, { ...raw, organizationId: null })).toBeNull();
    expect(projectSiemEvent(id, { ...raw, scope: "security" })).toBeNull();
    expect(
      projectSiemEvent(id, { ...raw, action: "audit.siem.send" }),
    ).toBeNull();
    expect(projectSiemEvent(id, { ...raw, sequence: "0" })).toBeNull();
    expect(
      projectSiemEvent(id, { ...raw, actorId: "secret" })?.actorId,
    ).toBeNull();
  });
  it("preserves sequence strings and escapes both CEF contexts", () => {
    const event = projectSiemEvent(id, raw)!;
    expect(
      (JSON.parse(formatSiemEvent(event, "json")) as { chainSequence: string })
        .chainSequence,
    ).toBe(raw.sequence);
    expect(formatSiemEvent(event, "cef")).toContain("externalId=" + id);
    expect(formatSiemEvent(event, "cef")).toContain(
      `rt=${Date.parse(event.occurredAt)}`,
    );
    expect(escapeCefHeader("a|b\\c\n")).toBe("a\\|b\\\\c\\n");
    expect(escapeCefExtension("a=b\\c\r\n")).toBe("a\\=b\\\\c\\r\\n");
  });
  it("frames Unicode by UTF8 bytes and rejects malformed values", () => {
    expect(frameSyslog("😀")).toBe("4 😀");
    expect(() =>
      formatSiemEvent(
        { ...projectSiemEvent(id, raw)!, action: "x".repeat(9000) },
        "json",
      ),
    ).toThrow();
    expect(projectSiemEvent(id, { ...raw, outcome: "leaked" })).toBeNull();
    expect(() => frameSyslog("x".repeat(16385))).toThrow("siem_frame_limit");
    expect(syslogMessage(projectSiemEvent(id, raw)!, "json")).toContain(
      "<134>1",
    );
    expect(siemCatalogue().eventClasses).toHaveLength(12);
    expect(projectSiemEvent(id, { ...raw, createdAt: "invalid" })).toBeNull();
    expect(
      projectSiemEvent(id, { ...raw, createdAt: "2026-10-07T01:00:00+01:00" })
        ?.occurredAt,
    ).toBe(raw.createdAt.replace("00Z", "00.000Z"));
    expect(
      formatSiemEvent(
        projectSiemEvent(id, { ...raw, outcome: "denied" })!,
        "cef",
      ),
    ).toContain("|6|");
    expect(
      projectSiemEvent(id, { ...raw, outcome: "cancelled" })?.outcome,
    ).toBe("cancelled");
    const absent = projectSiemEvent(id, {
      ...raw,
      outcome: null,
      actorType: null,
      actorId: null,
      entityId: null,
      correlationId: null,
    })!;
    expect(absent.outcome).toBe("unknown");
    expect(formatSiemEvent(absent, "cef")).toContain("suid= ");
  });
});

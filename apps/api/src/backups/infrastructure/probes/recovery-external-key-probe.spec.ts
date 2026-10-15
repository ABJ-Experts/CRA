/* eslint-disable @typescript-eslint/require-await -- Query test doubles resolve immediately. */
import type { RecoveryApplicationTarget } from "../restore/native-docker-recovery.adapter";
import { createRecoveryExternalKeyProbe } from "./recovery-external-key-probe";
describe("recovery external key decrypt-only capability", () => {
  it("returns only a boolean after real target Vault AEAD decryption", async () => {
    const sql = jest.fn(async (query: string) => {
      void query;
      return "true";
    });
    const probe = createRecoveryExternalKeyProbe(["vault_root"]);
    await expect(
      probe(
        "vault_root",
        { sql } as unknown as RecoveryApplicationTarget,
        new AbortController().signal,
      ),
    ).resolves.toBe(true);
    expect(sql.mock.calls[0]![0]).toContain("octet_length(decrypted_secret)");
    expect(sql.mock.calls[0]![0]).toContain("count(*)=0");
  });
  it("rejects unknown aliases, failed authenticated decryption and unexpected results", async () => {
    for (const result of ["false", "secret-material"]) {
      const sql = jest.fn(async () => result);
      const probe = createRecoveryExternalKeyProbe(["vault_root"]);
      await expect(
        probe(
          "unknown",
          { sql } as unknown as RecoveryApplicationTarget,
          new AbortController().signal,
        ),
      ).resolves.toBe(false);
      expect(sql).not.toHaveBeenCalled();
      await expect(
        probe(
          "vault_root",
          { sql } as unknown as RecoveryApplicationTarget,
          new AbortController().signal,
        ),
      ).resolves.toBe(false);
    }
    const sql = jest.fn(async () => {
      throw new Error("decrypted secret details");
    });
    await expect(
      createRecoveryExternalKeyProbe(["vault_root"])(
        "vault_root",
        { sql } as unknown as RecoveryApplicationTarget,
        new AbortController().signal,
      ),
    ).resolves.toBe(false);
  });
  it("validates mounted alias scope before execution", () => {
    expect(() => createRecoveryExternalKeyProbe(["../key"])).toThrow(
      "recovery_key_configuration",
    );
  });
});

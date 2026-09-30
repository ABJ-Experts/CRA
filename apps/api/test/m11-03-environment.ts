import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";

// Imported before AppModule, whose ConfigModule validates at module evaluation.
for (const name of [".env.local", ".env"]) {
  try {
    for (const [key, value] of Object.entries(
      parseEnv(readFileSync(resolve(name), "utf8")),
    ))
      process.env[key] ??= value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}
process.env.CONNECTOR_VAULT_KEYRING ??= JSON.stringify({
  activeKeyId: "m1103-fixture",
  keys: { "m1103-fixture": randomBytes(32).toString("base64") },
});

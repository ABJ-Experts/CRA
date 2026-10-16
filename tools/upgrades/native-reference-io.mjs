import {
  readFile,
  writeFile,
  mkdir,
  readdir,
  lstat,
  chmod,
  copyFile,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import https from "node:https";
import { join } from "node:path";
function fail(message) {
  throw new Error(`reference_fixture_prerequisite: ${message}`);
}
export async function run(
  args,
  environment,
  { spawnProcess = spawn, timeoutMs = 30000 } = {},
) {
  return new Promise((accept, reject) => {
    const child = spawnProcess("/usr/bin/docker", args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("fixture Docker deadline"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.length > 1024 * 1024) child.kill("SIGKILL");
    });
    child.stderr.resume();
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      code === 0
        ? accept(output)
        : reject(new Error("fixture Docker operation failed"));
    });
  });
}
export async function materialize(source, target, tokens) {
  const details = await lstat(source);
  if (!details.isDirectory() || details.isSymbolicLink())
    fail("template must be a local regular directory");
  await mkdir(target, { mode: 0o700 });
  for (const item of await readdir(source, { withFileTypes: true })) {
    if (item.isSymbolicLink() || (!item.isDirectory() && !item.isFile()))
      fail("template symlink/special file forbidden");
    const src = join(source, item.name),
      dst = join(target, item.name);
    if (item.isDirectory()) await materialize(src, dst, tokens);
    else if (/\.(?:json|ya?ml|env|conf)$/.test(item.name)) {
      let content = await readFile(src, "utf8");
      if (Buffer.byteLength(content) > 1024 * 1024)
        fail("template file too large");
      for (const [token, value] of Object.entries(tokens))
        content = content.replaceAll(token, value);
      await writeFile(dst, content, { mode: 0o600, flag: "wx" });
    } else {
      await copyFile(src, dst);
      await chmod(dst, 0o600);
    }
  }
}
export async function tlsRequest(
  config,
  path,
  { method = "GET", body, cookie, signal, timeoutMs = 10000 } = {},
) {
  const url = new URL(path, config.origin);
  if (url.origin !== new URL(config.origin).origin)
    fail("cross-origin fixture request forbidden");
  const [ca, cert, key] = await Promise.all([
    readFile(config.caPath),
    ...(config.certPath
      ? [readFile(config.certPath), readFile(config.keyPath)]
      : []),
  ]);
  const bytes = body ? Buffer.from(JSON.stringify(body)) : undefined;
  return new Promise((accept, reject) => {
    const call = https.request(
      url,
      {
        method,
        ca,
        cert,
        key,
        rejectUnauthorized: true,
        signal,
        timeout: timeoutMs,
        headers: {
          ...(bytes
            ? {
                "Content-Type": "application/json",
                "Content-Length": bytes.length,
              }
            : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (response) => {
        let text = "";
        response.on("data", (chunk) => {
          text += chunk;
          if (text.length > 1024 * 1024)
            response.destroy(new Error("fixture response too large"));
        });
        response.on("error", reject);
        response.on("end", () =>
          accept({
            status: response.statusCode,
            body: text,
            cookies: response.headers["set-cookie"] ?? [],
          }),
        );
      },
    );
    call.once("error", reject);
    call.once("timeout", () =>
      call.destroy(new Error("fixture request timeout")),
    );
    call.end(bytes);
  });
}

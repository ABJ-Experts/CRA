import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  stat,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import https from "node:https";
import { run, materialize, tlsRequest } from "./native-reference-io.mjs";
test("fixed Docker execution captures results and rejects failure, missing binary, overrun and excessive output", async () => {
  const local = (script) => (executable, args, options) => {
    assert.equal(executable, "/usr/bin/docker");
    assert.deepEqual(args, ["version"]);
    return spawn(process.execPath, ["-e", script], options);
  };
  assert.equal(
    await run(["version"], process.env, {
      spawnProcess: local("process.stdout.write('fixed Docker proof')"),
    }),
    "fixed Docker proof",
  );
  await assert.rejects(
    run(["version"], process.env, { spawnProcess: local("process.exit(2)") }),
    /operation failed/,
  );
  await assert.rejects(
    run([], process.env, {
      spawnProcess: (_exe, args, options) =>
        spawn("/missing-cra-test-bin", args, options),
    }),
    /ENOENT/,
  );
  await assert.rejects(
    run(["version"], process.env, {
      spawnProcess: local("setInterval(()=>{},1000)"),
      timeoutMs: 10,
    }),
    /deadline/,
  );
  await assert.rejects(
    run(["version"], process.env, {
      spawnProcess: local(
        "process.stdout.write('x'.repeat(2*1024*1024));setInterval(()=>{},1000)",
      ),
    }),
    /operation failed/,
  );
});
test("materialization replaces only reviewed text tokens and refuses symlink/non-directory/oversized inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "cra-reference-io-"));
  try {
    const source = join(root, "source");
    await mkdir(source);
    await mkdir(join(source, "nested"));
    await writeFile(join(source, "nested/config.json"), '{"root":"__ROOT__"}');
    await writeFile(join(source, "binary.tar"), Buffer.from([0, 1, 2, 3]));
    const output = join(root, "output");
    await materialize(source, output, { __ROOT__: "private" });
    assert.equal(
      await readFile(join(output, "nested/config.json"), "utf8"),
      '{"root":"private"}',
    );
    assert.deepEqual(
      await readFile(join(output, "binary.tar")),
      Buffer.from([0, 1, 2, 3]),
    );
    assert.equal((await stat(join(output, "binary.tar"))).mode & 0o777, 0o600);
    await assert.rejects(
      materialize(join(source, "binary.tar"), join(root, "bad-file"), {}),
      /regular directory/,
    );
    await symlink(source, join(root, "link"));
    await assert.rejects(
      materialize(join(root, "link"), join(root, "bad-link"), {}),
      /regular directory/,
    );
    await symlink(join(source, "binary.tar"), join(source, "child-link"));
    await assert.rejects(
      materialize(source, join(root, "bad-child"), {}),
      /symlink/,
    );
    await rm(join(source, "child-link"));
    await writeFile(
      join(source, "oversized.json"),
      "x".repeat(1024 * 1024 + 1),
    );
    await assert.rejects(
      materialize(source, join(root, "bad-large"), {}),
      /too large/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("local mTLS requires authenticated peer, preserves request bytes/cookies and bounds failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "cra-reference-tls-"));
  let server;
  try {
    const keyPath = join(root, "ephemeral.key"),
      caPath = join(root, "ephemeral.pem");
    const generated = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-keyout",
        keyPath,
        "-out",
        caPath,
      ],
      { stdio: "ignore" },
    );
    assert.equal(
      generated.status,
      0,
      "local ephemeral TLS test certificate generation",
    );
    const key = await readFile(keyPath),
      cert = await readFile(caPath);
    server = https.createServer(
      { key, cert, ca: cert, requestCert: true, rejectUnauthorized: true },
      (request, response) => {
        if (request.url === "/wait") return;
        if (request.url === "/large") {
          response.end("x".repeat(1024 * 1024 + 1));
          return;
        }
        if (request.url === "/empty") {
          response.writeHead(403);
          response.end();
          return;
        }
        let body = "";
        request.on("data", (chunk) => {
          body += chunk;
        });
        request.on("end", () => {
          response.setHeader("Set-Cookie", "fixture=yes; HttpOnly");
          response.end(
            JSON.stringify({
              authorized: request.socket.authorized,
              method: request.method,
              cookie: request.headers.cookie,
              body,
            }),
          );
        });
      },
    );
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const config = {
      origin: `https://127.0.0.1:${server.address().port}`,
      caPath,
      certPath: caPath,
      keyPath,
    };
    const echo = await tlsRequest(config, "/echo", {
      method: "POST",
      body: { exact: "bytes" },
      cookie: "fixture=session",
    });
    assert.equal(echo.status, 200);
    assert.deepEqual(JSON.parse(echo.body), {
      authorized: true,
      method: "POST",
      cookie: "fixture=session",
      body: '{"exact":"bytes"}',
    });
    assert.equal(echo.cookies.length, 1);
    assert.deepEqual((await tlsRequest(config, "/empty")).cookies, []);
    await assert.rejects(
      tlsRequest(config, "https://remote.invalid/forbidden"),
      /cross-origin/,
    );
    await assert.rejects(tlsRequest(config, "/large"), /too large/);
    await assert.rejects(
      tlsRequest(config, "/wait", { timeoutMs: 10 }),
      /timeout/,
    );
    await assert.rejects(
      tlsRequest(
        { ...config, certPath: undefined, keyPath: undefined },
        "/echo",
      ),
    );
    const aborted = new AbortController();
    aborted.abort();
    await assert.rejects(
      tlsRequest(config, "/echo", { signal: aborted.signal }),
    );
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});

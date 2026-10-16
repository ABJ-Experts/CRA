import http from "node:http";
import net from "node:net";
import {
  readFileSync,
  writeFileSync,
  renameSync,
  openSync,
  closeSync,
  fstatSync,
  fsyncSync,
  constants,
} from "node:fs";
function readControl(path) {
  const fd = openSync(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const details = fstatSync(fd);
    if (!details.isFile() || details.size > 4096)
      throw new Error("invalid maintenance request");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    closeSync(fd);
  }
}
const directory = process.env.CRA_MAINTENANCE_DIRECTORY;
const ackDirectory = process.env.CRA_MAINTENANCE_ACK_DIRECTORY;
if (!directory || !ackDirectory) throw new Error("maintenance mount required");
let active = 0;
function state() {
  try {
    const value = readControl(`${directory}/request.json`);
    if (
      value.version !== 1 ||
      typeof value.closed !== "boolean" ||
      !/^[0-9a-f-]{36}$/.test(value.generation)
    )
      return null;
    return value;
  } catch {
    return null;
  }
}
function acknowledge() {
  const request = state();
  if (!request?.closed || active !== 0) return;
  const target = `${ackDirectory}/ack.json`;
  writeFileSync(
    `${target}.tmp`,
    JSON.stringify({
      version: 1,
      generation: request.generation,
      serviceId: "edge",
      pid: process.pid,
      claimsClosed: true,
      drained: true,
    }),
    { mode: 0o600, flush: true },
  );
  renameSync(`${target}.tmp`, target);
  const dir = openSync(
    ackDirectory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
setInterval(() => {
  try {
    acknowledge();
  } catch {}
}, 250);
const routes = [
  ["/api/v1/", "http://api:3333"],
  ["/auth/v1/", "http://auth:9999"],
  ["/rest/v1/", "http://rest:3000"],
  ["/storage/v1/", "http://storage:5000"],
];
http
  .createServer((request, response) => {
    if (state()?.closed !== false) {
      response.writeHead(503, { "Retry-After": "30" });
      response.end();
      return;
    }
    active += 1;
    let done = false;
    const release = () => {
      if (!done) {
        done = true;
        active -= 1;
      }
    };
    // Downstream disconnect cannot prove upstream work completed.
    const selected = routes.find(([prefix]) => request.url?.startsWith(prefix));
    const target = new URL(selected?.[1] ?? "http://web:3000");
    // Auth/REST/Storage upstreams use root paths behind Supabase's API gateway.
    const path =
      selected && selected[0] !== "/api/v1/"
        ? request.url.slice(selected[0].length - 1)
        : request.url;
    const upstream = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        path,
        method: request.method,
        headers: { ...request.headers, "x-forwarded-proto": "https" },
      },
      (reply) => {
        reply.once("end", () => {
          if (reply.complete) release();
        });
        reply.on("error", () => response.destroy());
        if (!response.destroyed) {
          response.writeHead(reply.statusCode ?? 502, reply.headers);
          reply.pipe(response);
        } else reply.resume();
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end();
    });
    // An aborted request can leave server work uncertain; never treat it as drain.
    request.pipe(upstream);
  })
  .listen(8080, "0.0.0.0");
// TLS remains end-to-end; ingress retains client certificate verification.
net
  .createServer((socket) => {
    if (state()?.closed !== false) {
      socket.destroy();
      return;
    }
    active += 1;
    const upstream = net.connect(3443, "agent-ingress");
    socket.pipe(upstream);
    upstream.pipe(socket);
    // TLS transport cannot prove application completion. Agent ingress independently
    // acknowledges its HTTP work; an interrupted stream stays uncertain here.
    upstream.once("end", () => {
      active -= 1;
      socket.end();
    });
    socket.once("close", () => {
      upstream.destroy();
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  })
  .listen(3444, "0.0.0.0");

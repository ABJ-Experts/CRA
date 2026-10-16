import { request } from "node:https";
import type {
  CollectorTarget,
  SourceMetadataTransport,
} from "./operator-collector";
import { privateAddress } from "./operator-security";
/** Private literal IP targets avoid DNS rebinding and unexpected public egress. */
export class PrivateMetadataTransport implements SourceMetadataTransport {
  async read(
    target: CollectorTarget,
    cursor: string | null,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal.throwIfAborted();
    const url = new URL(target.endpoint);
    const host = url.hostname.replace(/^\[|\]$/g, "");
    if (
      url.protocol !== "https:" ||
      !privateAddress(host) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !["/", "/api/v1/operator/instance-metadata"].includes(url.pathname)
    )
      throw new Error("Invalid private source endpoint");
    url.pathname = "/api/v1/operator/instance-metadata";
    url.searchParams.set("limit", "100");
    if (cursor) url.searchParams.set("cursor", cursor);
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        {
          method: "GET",
          ca: target.ca,
          cert: target.cert,
          key: target.key,
          minVersion: "TLSv1.2",
          rejectUnauthorized: true,
          signal: AbortSignal.any([signal, AbortSignal.timeout(3000)]),
          agent: false,
          headers: { Accept: "application/json" },
        },
        (response) => {
          const declared = Number(response.headers["content-length"] ?? 0);
          if (response.statusCode !== 200 || declared > 256 * 1024) {
            response.destroy();
            reject(new Error("Private metadata response denied"));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > 256 * 1024) {
              response.destroy(
                new Error("Private metadata page exceeds bound"),
              );
              return;
            }
            chunks.push(chunk);
          });
          response.on("error", reject);
          response.on("end", () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
            } catch {
              reject(new Error("Invalid private metadata JSON"));
            }
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  }
}

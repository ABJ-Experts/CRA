import { request as httpsRequest } from "node:https";

import { resolveApprovedHttpsTarget } from "../../products/infrastructure/node-product-compliance-external-reference-validator";

export type CiProviderHttpResponse = Readonly<{
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: unknown;
}>;

export type CiProviderHttpRequest = Readonly<{
  url: string;
  method?: "GET" | "POST";
  headers: Readonly<Record<string, string>>;
  body?: string;
  allowedHosts: readonly string[];
}>;

export interface CiProviderHttp {
  request(
    this: void,
    input: CiProviderHttpRequest,
  ): Promise<CiProviderHttpResponse>;
}

const MAX_RESPONSE_BYTES = 65_536;
const TIMEOUT_MS = 10_000;

/** Revalidates public DNS and pins the selected address to the TLS socket. */
export class PinnedCiProviderHttp implements CiProviderHttp {
  async request(input: CiProviderHttpRequest): Promise<CiProviderHttpResponse> {
    const target = await resolveApprovedHttpsTarget(
      input.url,
      new Set(input.allowedHosts),
    );
    if (!target) throw new Error("CI provider endpoint is not approved");
    return new Promise((resolve, reject) => {
      const request = httpsRequest(
        {
          protocol: "https:",
          hostname: target.url.hostname,
          servername: target.url.hostname,
          family: target.family,
          method: input.method ?? "GET",
          path: `${target.url.pathname}${target.url.search}`,
          headers: {
            ...input.headers,
            ...(input.body
              ? { "content-length": Buffer.byteLength(input.body) }
              : {}),
          },
          maxHeaderSize: 16_384,
          lookup: (_hostname, _options, callback) =>
            callback(null, target.address, target.family),
        },
        (response) => {
          let bytes = 0;
          const chunks: Buffer[] = [];
          response.on("data", (chunk: Buffer) => {
            bytes += chunk.byteLength;
            if (bytes > MAX_RESPONSE_BYTES) {
              request.destroy(new Error("CI provider response is too large"));
              return;
            }
            chunks.push(chunk);
          });
          response.once("error", reject);
          response.once("end", () => {
            const status = response.statusCode ?? 0;
            if (status >= 300 && status < 400) {
              reject(new Error("CI provider redirect rejected"));
              return;
            }
            let body: unknown = null;
            if (chunks.length > 0) {
              try {
                body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              } catch {
                reject(new Error("Invalid CI provider response"));
                return;
              }
            }
            const retry = response.headers["retry-after"];
            const remaining = response.headers["x-ratelimit-remaining"];
            resolve({
              status,
              headers: {
                "retry-after": typeof retry === "string" ? retry : undefined,
                "x-ratelimit-remaining":
                  typeof remaining === "string" ? remaining : undefined,
              },
              body,
            });
          });
        },
      );
      request.setTimeout(TIMEOUT_MS, () =>
        request.destroy(new Error("CI provider request timed out")),
      );
      request.once("error", reject);
      request.end(input.body);
    });
  }
}

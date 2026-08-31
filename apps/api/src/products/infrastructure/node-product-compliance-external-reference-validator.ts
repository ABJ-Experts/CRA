import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { Injectable } from "@nestjs/common";
import type {
  ReserveSecurityUpdateArtifactInput,
  SecurityUpdateArtifact,
} from "@repo/contracts/products";

import type { ProductComplianceExternalReferenceValidator } from "../application/product-compliance-use-cases";

type Candidate = NonNullable<
  ReserveSecurityUpdateArtifactInput["externalReferenceCandidates"]
>[number];
type ValidatedReference =
  SecurityUpdateArtifact["publishedExternalReferences"][number];

type Resolver = Readonly<{
  lookup(hostname: string): Promise<readonly Readonly<{ address: string }>[]>;
}>;
type SafeRequestTarget = Readonly<{
  url: URL;
  address: string;
  family: 4 | 6;
}>;
type MonitorResponse = Readonly<{
  statusCode: number;
  headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  body: AsyncIterable<Uint8Array>;
  abort(): void;
}>;
type Fetcher = Readonly<{
  get(target: SafeRequestTarget): Promise<MonitorResponse>;
}>;

export type ExternalReferenceMonitorOutcome =
  | "verified"
  | "external_content_changed"
  | "type_mismatch"
  | "unavailable"
  | "provider_unavailable";

const maximumRedirects = 3;
const defaultMaximumMonitorBytes = 64 * 1024 * 1024;

/**
 * Fail-closed SSRF guard for approved external update references. It validates
 * syntax again, requires an explicit deployment allowlist, and makes DNS a
 * public-network boundary. Monitoring pins each revalidated DNS result to the
 * HTTPS socket and applies a strict byte and redirect budget.
 */
@Injectable()
export class NodeProductComplianceExternalReferenceValidator implements ProductComplianceExternalReferenceValidator {
  private readonly allowedHosts: ReadonlySet<string>;
  private readonly resolver: Resolver;
  private readonly now: () => Date;
  private readonly fetcher: Fetcher;
  private readonly maximumMonitorBytes: number;

  constructor(
    input: Readonly<{
      allowedHosts: readonly string[];
      resolver?: Resolver;
      now?: () => Date;
      fetcher?: Fetcher;
      maximumMonitorBytes?: number;
    }>,
  ) {
    const allowedHosts = input.allowedHosts
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0 && isHostName(host));
    this.allowedHosts = new Set(allowedHosts);
    this.resolver = input.resolver ?? { lookup: resolveAllAddresses };
    this.now = input.now ?? (() => new Date());
    this.fetcher = input.fetcher ?? { get: requestPinnedHttps };
    this.maximumMonitorBytes = validMaximumMonitorBytes(
      input.maximumMonitorBytes ?? defaultMaximumMonitorBytes,
    );
  }

  async validate(candidates: readonly Candidate[]) {
    const references: ValidatedReference[] = [];
    for (const candidate of candidates) {
      const validated = await this.validateOne(candidate);
      if (!validated)
        return Object.freeze({ outcome: "invalid_reference" as const });
      references.push(validated);
    }
    return Object.freeze({
      outcome: "validated" as const,
      references: Object.freeze(references),
    });
  }

  async monitor(
    input: Readonly<{
      candidates: readonly Candidate[];
      sha256: string;
      byteSize: number;
      contentType?: string;
    }>,
  ): Promise<Readonly<{ outcome: ExternalReferenceMonitorOutcome }>> {
    if (
      !/^[a-f0-9]{64}$/.test(input.sha256) ||
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 1
    ) {
      return Object.freeze({ outcome: "external_content_changed" as const });
    }
    if (input.byteSize > this.maximumMonitorBytes) {
      return Object.freeze({ outcome: "provider_unavailable" as const });
    }
    const candidate = input.candidates[0];
    if (!candidate) {
      return Object.freeze({ outcome: "external_content_changed" as const });
    }
    let current: URL;
    try {
      current = new URL(candidate.uri);
    } catch {
      return Object.freeze({ outcome: "external_content_changed" as const });
    }
    for (let redirects = 0; redirects <= maximumRedirects; redirects += 1) {
      const target = await this.targetFor(current);
      if (!target) {
        return Object.freeze({ outcome: "external_content_changed" as const });
      }
      let response: MonitorResponse;
      try {
        response = await this.fetcher.get(target);
      } catch {
        return Object.freeze({ outcome: "provider_unavailable" as const });
      }
      if (isRedirect(response.statusCode)) {
        const location = headerValue(response.headers, "location");
        response.abort();
        if (!location) {
          return Object.freeze({
            outcome: "external_content_changed" as const,
          });
        }
        try {
          current = new URL(location, current);
        } catch {
          return Object.freeze({
            outcome: "external_content_changed" as const,
          });
        }
        continue;
      }
      if (response.statusCode === 404 || response.statusCode === 410) {
        response.abort();
        return Object.freeze({ outcome: "external_content_changed" as const });
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.abort();
        return Object.freeze({ outcome: "provider_unavailable" as const });
      }
      return this.monitorBody(response, input);
    }
    return Object.freeze({ outcome: "external_content_changed" as const });
  }

  private async validateOne(
    candidate: Candidate,
  ): Promise<ValidatedReference | null> {
    const target = await this.targetFor(candidate.uri);
    if (!target) return null;
    const { url } = target;
    const validatedAt = this.now();
    if (!Number.isFinite(validatedAt.getTime())) return null;
    return Object.freeze({
      id: candidate.id,
      title: candidate.title,
      uri: url.toString(),
      validationState: "validated_by_server",
      validatedAt: validatedAt.toISOString(),
    });
  }

  private async targetFor(
    value: string | URL,
  ): Promise<SafeRequestTarget | null> {
    let url: URL;
    let addresses: readonly Readonly<{ address: string }>[];
    try {
      url = value instanceof URL ? new URL(value.toString()) : new URL(value);
    } catch {
      return null;
    }
    const hostname = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      url.username !== "" ||
      url.password !== "" ||
      url.port !== "" ||
      isIP(hostname) !== 0 ||
      !this.allowedHosts.has(hostname)
    ) {
      return null;
    }
    try {
      addresses = await this.resolver.lookup(hostname);
    } catch {
      return null;
    }
    if (
      addresses.length === 0 ||
      addresses.some(({ address }) => !isPublicAddress(address))
    ) {
      return null;
    }
    const address = addresses[0]?.address;
    const family = address ? isIP(address) : 0;
    if (!address || (family !== 4 && family !== 6)) return null;
    return Object.freeze({ url, address, family });
  }

  private async monitorBody(
    response: MonitorResponse,
    expected: Readonly<{
      sha256: string;
      byteSize: number;
      contentType?: string;
    }>,
  ): Promise<Readonly<{ outcome: ExternalReferenceMonitorOutcome }>> {
    const contentLength = headerValue(response.headers, "content-length");
    if (
      contentLength !== undefined &&
      Number(contentLength) !== expected.byteSize
    ) {
      response.abort();
      return Object.freeze({ outcome: "external_content_changed" as const });
    }
    if (
      expected.contentType !== undefined &&
      normalizedContentType(headerValue(response.headers, "content-type")) !==
        normalizedContentType(expected.contentType)
    ) {
      response.abort();
      return Object.freeze({ outcome: "type_mismatch" as const });
    }
    const hash = createHash("sha256");
    let byteSize = 0;
    try {
      for await (const value of response.body) {
        const chunk = Buffer.from(value);
        byteSize += chunk.byteLength;
        if (
          byteSize > expected.byteSize ||
          byteSize > this.maximumMonitorBytes
        ) {
          response.abort();
          return Object.freeze({
            outcome: "external_content_changed" as const,
          });
        }
        hash.update(chunk);
      }
    } catch {
      return Object.freeze({ outcome: "provider_unavailable" as const });
    }
    return byteSize === expected.byteSize &&
      hash.digest("hex") === expected.sha256
      ? Object.freeze({ outcome: "verified" as const })
      : Object.freeze({ outcome: "external_content_changed" as const });
  }
}

const requestPinnedHttps = (
  target: SafeRequestTarget,
): Promise<MonitorResponse> =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: target.url.hostname,
        method: "GET",
        path: `${target.url.pathname}${target.url.search}`,
        headers: { accept: "application/octet-stream, */*;q=0.1" },
        lookup: (
          _hostname: string,
          _options: unknown,
          callback: (
            error: Error | null,
            address: string,
            family: number,
          ) => void,
        ) => callback(null, target.address, target.family),
      },
      (response) =>
        resolve(
          Object.freeze({
            statusCode: response.statusCode ?? 0,
            headers: response.headers,
            body: response,
            abort: () => response.destroy(),
          }),
        ),
    );
    request.setTimeout(10_000, () =>
      request.destroy(new Error("monitor_timeout")),
    );
    request.once("error", reject);
    request.end();
  });

const isRedirect = (statusCode: number): boolean =>
  statusCode === 301 ||
  statusCode === 302 ||
  statusCode === 303 ||
  statusCode === 307 ||
  statusCode === 308;

const headerValue = (
  headers: MonitorResponse["headers"],
  name: string,
): string | undefined => {
  const value = headers[name];
  return typeof value === "string" ? value : value?.[0];
};

const normalizedContentType = (value: string | undefined): string =>
  value?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

const validMaximumMonitorBytes = (value: number): number =>
  Number.isSafeInteger(value) && value >= 1 && value <= 2_147_483_647
    ? value
    : defaultMaximumMonitorBytes;

const resolveAllAddresses = async (
  hostname: string,
): Promise<readonly Readonly<{ address: string }>[]> =>
  (await lookup(hostname, { all: true, verbatim: true })).map(({ address }) =>
    Object.freeze({ address }),
  );

const isHostName = (host: string): boolean =>
  host.length <= 253 &&
  host !== "localhost" &&
  host
    .split(".")
    .every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
    );

const isPublicAddress = (address: string): boolean => {
  const kind = isIP(address);
  if (kind === 4) return isPublicIpv4(address);
  if (kind === 6) return isPublicIpv6(address);
  return false;
};

const isPublicIpv4 = (address: string): boolean => {
  const values = address.split(".").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isInteger(value))) {
    return false;
  }
  const [first, second] = values as [number, number, number, number];
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 192 && second === 0) ||
    (first === 192 && (second === 2 || second === 88)) ||
    (first === 198 && (second === 18 || second === 19 || second === 51)) ||
    (first === 203 && second === 0 && values[2] === 113)
  );
};

const isPublicIpv6 = (address: string): boolean => {
  const bytes = ipv6Bytes(address);
  if (!bytes) return false;
  if (bytes.every((value) => value === 0)) return false;
  if (bytes.slice(0, 15).every((value) => value === 0) && bytes[15] === 1)
    return false;
  if ((bytes[0] ?? 0) === 0xff) return false;
  if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return false;
  if ((bytes[0] ?? 0) === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80)
    return false;
  // Documentation and Teredo are never valid deployment origins.
  if (
    (bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x0d &&
      bytes[3] === 0xb8) ||
    (bytes[0] === 0x20 &&
      bytes[1] === 0x01 &&
      bytes[2] === 0x00 &&
      bytes[3] === 0x00)
  ) {
    return false;
  }
  const lastIpv4 = ipv4FromBytes(bytes.slice(12));
  if (
    bytes.slice(0, 10).every((value) => value === 0) &&
    ((bytes[10] === 0xff && bytes[11] === 0xff) ||
      (bytes[10] === 0 && bytes[11] === 0))
  ) {
    return isPublicIpv4(lastIpv4);
  }
  // 6to4 and the well-known NAT64 prefix embed an IPv4 destination. Reject
  // either form when it would route to a non-public IPv4 address.
  if (bytes[0] === 0x20 && bytes[1] === 0x02) {
    return isPublicIpv4(ipv4FromBytes(bytes.slice(2, 6)));
  }
  if (
    bytes[0] === 0x00 &&
    bytes[1] === 0x64 &&
    bytes[2] === 0xff &&
    bytes[3] === 0x9b &&
    bytes.slice(4, 12).every((value) => value === 0)
  ) {
    return isPublicIpv4(lastIpv4);
  }
  return true;
};

const ipv6Bytes = (address: string): readonly number[] | null => {
  const normalized = address.toLowerCase();
  if (normalized.includes(".")) return null;
  const split = normalized.split("::");
  if (split.length > 2) return null;
  const left = split[0] === "" ? [] : (split[0]?.split(":") ?? []);
  const right =
    split.length === 1 || split[1] === "" ? [] : (split[1]?.split(":") ?? []);
  if (
    left.length + right.length > 8 ||
    (split.length === 1 && left.length !== 8)
  )
    return null;
  const groups = [
    ...left,
    ...Array<string>(8 - left.length - right.length).fill("0"),
    ...right,
  ];
  if (
    groups.length !== 8 ||
    groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))
  ) {
    return null;
  }
  return groups.flatMap((group) => {
    const value = Number.parseInt(group, 16);
    return [value >>> 8, value & 0xff];
  });
};

const ipv4FromBytes = (bytes: readonly number[]): string => bytes.join(".");

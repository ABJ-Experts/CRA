import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { Injectable } from "@nestjs/common";

import { isPublicNetworkAddress } from "../../../products/infrastructure/node-product-compliance-external-reference-validator";
import { SupabaseService } from "../../../supabase/supabase.service";
import type {
  VulnerabilityVexPublicationClaim,
  VulnerabilityVexPublicationDelivery,
} from "../application/vulnerability-vex-publication.port";
import type { VexExportStoragePort } from "../vex-export.port";
import {
  ConfiguredVexPublicationTargetRegistry,
  type ConfiguredVexPublicationTarget,
} from "./configured-vex-publication-target-registry";

type Resolver = Readonly<{
  lookup(hostname: string): Promise<readonly Readonly<{ address: string }>[]>;
}>;
type Put = (
  input: Readonly<{
    url: URL;
    address: string;
    family: 4 | 6;
    bytes: Buffer;
    idempotencyKey: string;
    credential: string | null;
  }>,
) => Promise<Readonly<{ status: number }>>;
const maximumBytes = 50 * 1024 * 1024;

/** Publishes only already-verified immutable bytes to a deployment-owned target. */
@Injectable()
export class NodeVexPublicationDeliveryAdapter implements VulnerabilityVexPublicationDelivery {
  constructor(
    private readonly storage: VexExportStoragePort,
    private readonly registry: ConfiguredVexPublicationTargetRegistry,
    private readonly supabase: SupabaseService,
    private readonly resolver: Resolver = { lookup: resolveAll },
    private readonly put: Put = pinnedPut,
    private readonly environment: Readonly<
      Record<string, string | undefined>
    > = process.env,
  ) {}

  async deliver(
    claim: VulnerabilityVexPublicationClaim,
  ): Promise<
    Readonly<{ remoteVersion: string | null; httpStatus: number | null }>
  > {
    const target = this.registry.find(claim.targetKey);
    if (!target) throw new Error("configured publication target unavailable");
    const bytes =
      claim.kind === "withdraw"
        ? null
        : await this.storage.readImmutable({
            organizationId: claim.organizationId,
            objectKey: claim.storageObjectPath,
          });
    if (
      claim.kind !== "withdraw" &&
      (!bytes ||
        bytes.byteLength > maximumBytes ||
        createHash("sha256").update(bytes).digest("hex") !==
          claim.contentSha256)
    )
      throw new Error("immutable VEX export is unavailable or corrupt");
    if (target.kind === "supabase_storage") {
      await this.publishToStorage(target, claim, bytes);
      return Object.freeze({
        remoteVersion: claim.contentSha256,
        httpStatus: null,
      });
    }
    await this.publishToHttps(target, claim, bytes);
    return Object.freeze({
      remoteVersion: claim.contentSha256,
      httpStatus: 200,
    });
  }

  private async publishToStorage(
    target: Extract<
      ConfiguredVexPublicationTarget,
      { kind: "supabase_storage" }
    >,
    claim: VulnerabilityVexPublicationClaim,
    bytes: Buffer | null,
  ): Promise<void> {
    const versionPath = `${target.prefix}/${claim.organizationId}/${claim.contentSha256}.json`;
    const mediaType =
      claim.format === "openvex"
        ? "application/vnd.openvex+json"
        : "application/vnd.cyclonedx+json";
    if (claim.kind === "publish") {
      const version = await this.supabase
        .admin()
        .storage.from(target.bucket)
        .upload(versionPath, bytes!, { contentType: mediaType, upsert: false });
      if (
        version.error &&
        !/exist|duplicate|409/i.test(version.error.message ?? "")
      )
        throw new Error("storage publication failed");
    }
    const pointer = Buffer.from(JSON.stringify(pointerDocument(claim)), "utf8");
    const current = await this.supabase
      .admin()
      .storage.from(target.bucket)
      .upload(
        `${target.prefix}/${claim.organizationId}/current.json`,
        pointer,
        { contentType: "application/json", upsert: true },
      );
    if (current.error) throw new Error("storage pointer update failed");
  }

  private async publishToHttps(
    target: Exclude<
      ConfiguredVexPublicationTarget,
      { kind: "supabase_storage" }
    >,
    claim: VulnerabilityVexPublicationClaim,
    bytes: Buffer | null,
  ): Promise<void> {
    const credential = target.credentialEnv
      ? (this.environment[target.credentialEnv] ?? null)
      : null;
    if (target.credentialEnv && !credential)
      throw new Error("configured publication credential unavailable");
    if (claim.kind === "publish") {
      const versionUrl = renderTemplate(target.versionedUrlTemplate, claim);
      const versionResponse = await this.request(
        versionUrl,
        target,
        bytes!,
        claim.eventKey,
        credential,
      );
      if (versionResponse.status < 200 || versionResponse.status >= 300)
        throw new Error("publication target rejected the versioned VEX export");
    }
    const pointerBytes = Buffer.from(
      JSON.stringify(pointerDocument(claim)),
      "utf8",
    );
    const pointerResponse = await this.request(
      new URL(target.pointerUrl),
      target,
      pointerBytes,
      `${claim.eventKey}:pointer`,
      credential,
    );
    if (pointerResponse.status < 200 || pointerResponse.status >= 300)
      throw new Error("publication target rejected the current VEX pointer");
  }

  private async request(
    url: URL,
    target: Exclude<
      ConfiguredVexPublicationTarget,
      { kind: "supabase_storage" }
    >,
    bytes: Buffer,
    idempotencyKey: string,
    credential: string | null,
  ) {
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !target.allowedHosts
        .map((host) => host.toLowerCase())
        .includes(url.hostname.toLowerCase()) ||
      isIP(url.hostname) !== 0
    )
      throw new Error("publication egress blocked");
    const addresses = await this.resolver.lookup(url.hostname);
    if (
      !addresses.length ||
      addresses.some(({ address }) => !isPublicNetworkAddress(address))
    )
      throw new Error("publication egress blocked");
    const address = addresses[0]?.address;
    const family = address ? isIP(address) : 0;
    if (!address || (family !== 4 && family !== 6))
      throw new Error("publication egress blocked");
    return this.put({
      url,
      address,
      family,
      bytes,
      idempotencyKey,
      credential,
    });
  }
}

function pointerDocument(claim: VulnerabilityVexPublicationClaim) {
  return claim.kind === "withdraw"
    ? Object.freeze({ version: 1, withdrawn: true })
    : Object.freeze({
        version: 1,
        contentSha256: claim.contentSha256,
        format: claim.format,
      });
}
function renderTemplate(
  template: string,
  claim: VulnerabilityVexPublicationClaim,
): URL {
  return new URL(
    template
      .replaceAll("{organizationId}", claim.organizationId)
      .replaceAll("{sha256}", claim.contentSha256),
  );
}
async function resolveAll(
  hostname: string,
): Promise<readonly Readonly<{ address: string }>[]> {
  return (await lookup(hostname, { all: true, verbatim: true })).map(
    ({ address }) => Object.freeze({ address }),
  );
}
const pinnedPut: Put = (input) =>
  new Promise((resolve, reject) => {
    const request = httpsRequest(
      {
        protocol: "https:",
        hostname: input.url.hostname,
        method: "PUT",
        path: `${input.url.pathname}${input.url.search}`,
        lookup: (_host, _options, callback) =>
          callback(null, input.address, input.family),
        headers: {
          "content-type": "application/json",
          "content-length": String(input.bytes.byteLength),
          "idempotency-key": input.idempotencyKey,
          ...(input.credential ? { authorization: input.credential } : {}),
        },
      },
      (response) => {
        response.resume();
        resolve(Object.freeze({ status: response.statusCode ?? 0 }));
      },
    );
    request.setTimeout(10_000, () =>
      request.destroy(new Error("publication_timeout")),
    );
    request.once("error", reject);
    request.end(input.bytes);
  });

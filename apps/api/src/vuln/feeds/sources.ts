// The five feed sources (FR-VULN-001). Thin IO over the pure parsers in
// normalise.ts — everything interesting to test lives there, everything here is
// URL construction and pagination.
import { gunzipSync } from 'node:zlib';
import { ecosystemForPurlType, joinUpstreamName } from '@repo/sbom-core';
import {
  EMPTY_BATCH,
  type FeedBatch,
  type FeedHttp,
  type FeedSource,
  type FeedSyncContext,
  type RawAdvisory,
} from './feed-source';
import {
  kevCatalogueVersion,
  normaliseEpss,
  normaliseGhsa,
  normaliseKev,
  normaliseNvd,
  normaliseOsv,
} from './normalise';

export const FEED_ENDPOINTS = {
  osvQueryBatch: 'https://api.osv.dev/v1/querybatch',
  osvVuln: 'https://api.osv.dev/v1/vulns',
  nvd: 'https://services.nvd.nist.gov/rest/json/cves/2.0',
  ghsa: 'https://api.github.com/advisories',
  kev: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
  epss: 'https://epss.empiricalsecurity.com/epss_scores-current.csv.gz',
} as const;

/** FR-DEP-008: every endpoint is overridable so an offline mirror can serve them. */
function endpoint(key: keyof typeof FEED_ENDPOINTS, envVar: string): string {
  return process.env[envVar] ?? FEED_ENDPOINTS[key];
}

export class FetchFeedHttp implements FeedHttp {
  constructor(private readonly timeoutMs = 30_000) {}

  private async request(
    url: string,
    headers?: Record<string, string>,
    body?: unknown,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: {
          'user-agent': 'cra-sentinel-feed-sync',
          ...(body ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok)
        throw new Error(`${url} responded ${res.status} ${res.statusText}`);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  async getJson(
    url: string,
    headers?: Record<string, string>,
  ): Promise<unknown> {
    return (await this.request(url, headers)).json();
  }

  async postJson(url: string, body: unknown): Promise<unknown> {
    return (await this.request(url, undefined, body)).json();
  }

  async getText(
    url: string,
    headers?: Record<string, string>,
  ): Promise<string> {
    const res = await this.request(url, headers);
    const buf = Buffer.from(await res.arrayBuffer());
    // gzip magic. The caller asked for text and should not care how it arrived.
    const gzipped = buf[0] === 0x1f && buf[1] === 0x8b;
    return (gzipped ? gunzipSync(buf) : buf).toString('utf8');
  }
}

// ---------------------------------------------------------------------------

/** Our comparator families are coarser than OSV's registries; the PURL type is not. */
const OSV_ECOSYSTEM_BY_PURL_TYPE: Record<string, string> = {
  npm: 'npm',
  cargo: 'crates.io',
  gem: 'RubyGems',
  nuget: 'NuGet',
  composer: 'Packagist',
  pypi: 'PyPI',
  maven: 'Maven',
  golang: 'Go',
  go: 'Go',
  deb: 'Debian',
  rpm: 'Red Hat',
};

/**
 * OSV is mirrored on demand: we ask only about the (ecosystem, package) pairs
 * that actually appear in some tenant's SBOM.
 *
 * The alternative is the bulk per-ecosystem zip export — hundreds of thousands of
 * records, most for packages nobody here ships. Demand seeding matches the
 * matcher's own access pattern (loadLookup queries by the component names in the
 * release) and keeps the mirror authoritative for this deployment, which is what
 * FR-VULN-001 actually requires: once synced, matching reads local rows only and
 * a feed outage does not stop work.
 *
 * The limitation, stated plainly: a package that has never appeared in an SBOM
 * has no advisories mirrored until the first ingest that mentions it. The ingest
 * pipeline therefore triggers a sync before matching a newly seen package.
 */
export class OsvFeedSource implements FeedSource {
  readonly key = 'osv' as const;

  async fetch(
    _checkpoint: string | null,
    ctx: FeedSyncContext,
  ): Promise<FeedBatch> {
    const packages = await ctx.knownPackages();
    if (packages.length === 0) return EMPTY_BATCH;

    const queries = packages
      .map((p) => {
        const ecosystem = OSV_ECOSYSTEM_BY_PURL_TYPE[p.purlType.toLowerCase()];
        if (!ecosystem) return null;
        // Ask OSV for the package under ITS OWN naming convention, rebuilt from
        // the PURL coordinate. Doing this for Maven alone (as this once did)
        // meant "@babel/core" was requested as "core" and "github.com/x/y" as
        // "y", so those advisories were never mirrored in the first place — a
        // false negative one layer earlier than the matcher.
        const comparator = ecosystemForPurlType(p.purlType);
        const name = comparator
          ? joinUpstreamName(comparator, {
              namespace: p.namespace,
              name: p.name,
            })
          : p.name;
        return { package: { name, ecosystem } };
      })
      .filter((q): q is { package: { name: string; ecosystem: string } } =>
        Boolean(q),
      );
    if (queries.length === 0) return EMPTY_BATCH;

    const ids = new Set<string>();
    // OSV caps querybatch at 1000 queries per request.
    for (let i = 0; i < queries.length; i += 1000) {
      for (const id of await postBatch(ctx.http, queries.slice(i, i + 1000)))
        ids.add(id);
    }

    const advisories: RawAdvisory[] = [];
    for (const id of ids) {
      const doc = await ctx.http.getJson(
        `${endpoint('osvVuln', 'FEED_OSV_VULN_URL')}/${encodeURIComponent(id)}`,
      );
      const normalised = normaliseOsv(doc);
      // Keep only advisories that produced at least one comparable range —
      // an advisory we cannot version-compare can never yield a finding, and
      // storing it would inflate the mirror's apparent coverage.
      if (normalised && normalised.affected.length > 0)
        advisories.push(normalised);
    }

    return { advisories, enrichments: [], checkpoint: null, hasMore: false };
  }
}

async function postBatch(
  http: FeedHttp,
  queries: { package: { name: string; ecosystem: string } }[],
): Promise<string[]> {
  const url = endpoint('osvQueryBatch', 'FEED_OSV_QUERYBATCH_URL');
  const payload = await http.postJson(url, { queries });

  const results = (payload as { results?: { vulns?: { id?: string }[] }[] })
    .results;
  const ids: string[] = [];
  for (const r of results ?? [])
    for (const v of r.vulns ?? []) if (v.id) ids.push(v.id);
  return ids;
}

// ---------------------------------------------------------------------------

/**
 * NVD is genuinely incremental: `lastModStartDate` resumes from the checkpoint.
 * Without a key NVD allows 5 requests per 30s, so a first sync of the whole
 * catalogue is slow by design — the checkpoint is what makes that a one-off.
 */
export class NvdFeedSource implements FeedSource {
  readonly key = 'nvd' as const;
  constructor(private readonly pageSize = 2000) {}

  async fetch(
    checkpoint: string | null,
    ctx: FeedSyncContext,
  ): Promise<FeedBatch> {
    const base = endpoint('nvd', 'FEED_NVD_URL');
    const params = new URLSearchParams({
      resultsPerPage: String(this.pageSize),
      startIndex: '0',
    });
    if (checkpoint) {
      params.set('lastModStartDate', checkpoint);
      params.set('lastModEndDate', new Date().toISOString());
    }
    const headers = process.env.NVD_API_KEY
      ? { apiKey: process.env.NVD_API_KEY }
      : undefined;

    const payload = (await ctx.http.getJson(
      `${base}?${params.toString()}`,
      headers,
    )) as {
      vulnerabilities?: unknown[];
      totalResults?: number;
      startIndex?: number;
      resultsPerPage?: number;
    };

    const advisories: RawAdvisory[] = [];
    let newest = checkpoint;
    for (const item of payload.vulnerabilities ?? []) {
      const a = normaliseNvd(item);
      if (!a) continue;
      advisories.push(a);
      const mod = a.modifiedAt?.toISOString() ?? null;
      if (mod && (!newest || mod > newest)) newest = mod;
    }

    const seen = (payload.startIndex ?? 0) + (payload.resultsPerPage ?? 0);
    return {
      advisories,
      enrichments: [],
      checkpoint: newest,
      hasMore: seen < (payload.totalResults ?? 0),
    };
  }
}

// ---------------------------------------------------------------------------

export class GhsaFeedSource implements FeedSource {
  readonly key = 'ghsa' as const;
  constructor(private readonly perPage = 100) {}

  async fetch(
    checkpoint: string | null,
    ctx: FeedSyncContext,
  ): Promise<FeedBatch> {
    const params = new URLSearchParams({
      per_page: String(this.perPage),
      sort: 'updated',
      direction: 'asc',
    });
    if (checkpoint) params.set('modified', `>${checkpoint}`);

    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
    };
    if (process.env.GITHUB_TOKEN)
      headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

    const payload = (await ctx.http.getJson(
      `${endpoint('ghsa', 'FEED_GHSA_URL')}?${params.toString()}`,
      headers,
    )) as unknown[];

    const advisories: RawAdvisory[] = [];
    let newest = checkpoint;
    for (const item of payload ?? []) {
      const a = normaliseGhsa(item);
      if (!a || a.affected.length === 0) continue;
      advisories.push(a);
      const mod = a.modifiedAt?.toISOString() ?? null;
      if (mod && (!newest || mod > newest)) newest = mod;
    }

    return {
      advisories,
      enrichments: [],
      checkpoint: newest,
      hasMore: (payload?.length ?? 0) === this.perPage,
    };
  }
}

// ---------------------------------------------------------------------------

/**
 * KEV is small (~1,500 entries) and has no incremental mode, so it is read whole
 * every hour. The catalogue version is the checkpoint purely so an unchanged
 * catalogue can be recognised and skipped.
 */
export class KevFeedSource implements FeedSource {
  readonly key = 'kev' as const;

  async fetch(
    checkpoint: string | null,
    ctx: FeedSyncContext,
  ): Promise<FeedBatch> {
    const payload = await ctx.http.getJson(endpoint('kev', 'FEED_KEV_URL'));
    const version = kevCatalogueVersion(payload);
    if (version && version === checkpoint)
      return { ...EMPTY_BATCH, checkpoint: version };
    return {
      advisories: [],
      enrichments: normaliseKev(payload),
      checkpoint: version,
      hasMore: false,
    };
  }
}

export class EpssFeedSource implements FeedSource {
  readonly key = 'epss' as const;

  async fetch(
    checkpoint: string | null,
    ctx: FeedSyncContext,
  ): Promise<FeedBatch> {
    const csv = await ctx.http.getText(endpoint('epss', 'FEED_EPSS_URL'));
    const { enrichments, scoreDate } = normaliseEpss(csv);
    if (scoreDate && scoreDate === checkpoint)
      return { ...EMPTY_BATCH, checkpoint: scoreDate };
    return {
      advisories: [],
      enrichments,
      checkpoint: scoreDate,
      hasMore: false,
    };
  }
}

export function defaultFeedSources(): FeedSource[] {
  return [
    new OsvFeedSource(),
    new NvdFeedSource(),
    new GhsaFeedSource(),
    new KevFeedSource(),
    new EpssFeedSource(),
  ];
}

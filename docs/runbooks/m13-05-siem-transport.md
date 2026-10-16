# SIEM collector transport verification

Production destinations use DNS hostnames approved in `SIEM_APPROVED_TARGETS_JSON`:

```json
[{"protocol":"https","hostname":"collector.example.com","port":443},{"protocol":"syslog_tls","hostname":"syslog.example.com","port":6514}]
```

The exact protocol, hostname and port must match. Public DNS is rechecked for every attempt and the chosen address is pinned to the socket while retaining hostname certificate verification. Private addresses, URL credentials, query strings, fragments, redirects and insecure certificate options are rejected. TLS requires version 1.2 or newer. HTTPS accepts a bearer token or client certificate bundle; syslog requires client certificates. Credential material stays encrypted under the existing connector keyring with a SIEM-specific authenticated context.

HTTPS sends one event per POST as JSON or UTF-8 CEF. Status headers are the acknowledgement: any 2xx means collector accepted, not indexed or durably stored. Response bodies are destroyed without consumption. TLS syslog wraps the same payload in RFC 5424 and uses RFC 5425 octet-count framing. A successful local socket write is labelled **sent—receipt unconfirmed**. There is no application acknowledgement; interrupted writes can duplicate on retry. Receiver deduplication must use the stable event identity, never an attempt ID.

Run the owned collector fixture and unit transport checks:

```sh
pnpm --filter api run test --runInBand 'siem-collector.spec|node-siem-transport.spec|siem-vault.spec'
```

The fixture requires `openssl`. It creates certificates and listeners in an owned temporary directory, tests authenticated HTTPS and syslog with both JSON and CEF, and checks a 429 response without consuming its private canary body. Test-only socket factories route to owned loopback listeners; production DNS approval has no loopback bypass. Temporary key files are removed when the fixture closes. Do not point the fixture at a customer endpoint or use production credentials.

For customer validation, first approve the hostname and port through deployment configuration, provision credentials through the owner-only API, then run the explicit connection test. Confirm the collector sees the synthetic test identity. Enable forwarding separately. Test traffic is structural and does not disclose source evidence. Record the collector's deduplication and acknowledgement semantics in deployment evidence.

Rotation validates PEM encoding, current client certificate dates and private-key matching before encryption. Existing envelopes bind organization, destination, credential identity and revision. Changing any bound identity fails decryption. Coordinate master-key retirement with the vault reference inspection workflow; never remove a key still referenced by a credential envelope or request fingerprint.

Troubleshooting uses safe failure codes only. Do not log request headers, decrypted keys, receiver response bodies or sensitive URLs. Certificate errors and redirects are permanent failures. Network errors, timeouts, 408/425/429 and eligible 5xx statuses can retry under the durable worker policy. `Retry-After` is bounded to 24 hours. Recheck current authorization immediately before network dispatch.

## Scoped master-key maintenance

Keep both the old and new master keys in `CONNECTOR_VAULT_KEYRING`, selecting the new key as active. Inspect recovery references first:

```sh
pnpm --filter api run vault:siem -- --org ORGANIZATION_UUID
```

The command defaults to dry-run, scans at most 50 envelopes per page and reports only counts/key identifiers. It includes immutable security-receipt HMAC key references. A missing recovery key or truncated reference report blocks execution. To rewrap current credential envelopes explicitly:

```sh
pnpm --filter api run vault:siem -- --org ORGANIZATION_UUID --execute --batch-size 50
```

Rewrapping preserves organization/destination/credential/revision AAD and does not rotate the customer's credential. Each update compares the complete prior envelope transactionally, records a durable security receipt and fences stale worker leases. Conflicts or unrecoverable envelopes produce a failing exit code and remain available for investigation; the command neither overwrites concurrently changed credentials nor deletes anything.

Retain an old key while any immutable command fingerprint or backup references it. A report with zero active envelope references does **not** authorize removing a key. Rollback selects the prior active master key while retaining both key materials; existing and rewrapped envelopes remain readable. This maintenance command has no public API or browser route.

The development browser harness reuses its validated protected local keyring across restarts. A missing file is published exclusively with mode 0600; an invalid existing file is preserved and rejected. Never regenerate key material under an existing key identifier. Retain recovery material while fixture envelopes or immutable request fingerprints reference it, and remove only owned plaintext temporary collector credentials after verification.

Protocol references: [CEF format](https://www.microfocus.com/documentation/arcsight/arcsight-smartconnectors-8.3/cef-implementation-standard/Content/CEF/Chapter%201%20What%20is%20CEF.htm) and [RFC 5425 TLS syslog framing](https://www.rfc-editor.org/rfc/rfc5425.html#section-4.3).

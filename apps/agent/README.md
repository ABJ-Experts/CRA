# CRA Sentinel outbound integration agent

This Linux agent reads one locally configured, canonical source for one CRA connector. It opens outbound HTTPS connections to CRA; it has no listener, remote command route, script runner, or source write operation. Teamcenter and Windchill exports require customer schema validation and a separate connector per source.

## Build and install

From the repository root, with Node.js 20+, pnpm 10.33.4, OpenSSL, and a Linux build host matching the target CPU/libc and Node major version for the native SQLite module:

```sh
pnpm --filter @repo/contracts build
pnpm --filter agent build
pnpm --filter agent test
pnpm --filter agent deploy --prod --legacy /tmp/cra-agent-release
sudo sh /tmp/cra-agent-release/deploy/install.sh /tmp/cra-agent-release
```

The install script creates a fixed `cra-agent` account, a versioned release, `/var/lib/cra-agent` (0700), and a systemd unit. It preserves existing config and state on upgrade. To build the non-root container, run `docker build -f apps/agent/Dockerfile -t cra-agent:0.1.0 .` from the repository root and mount `/etc/cra-agent/config.json` and CA files read-only plus a writable, private `/var/lib/cra-agent` volume owned by UID 65532. Rebuild the image for each release; do not copy a macOS-built `node_modules` into Linux.

## Configure and enroll

Edit `/etc/cra-agent/config.json` from `config.example.json`. It contains paths and allowlists only. Keep one source in `sources`; a second internal source needs its own CRA connector and agent identity. Place the CRA ingress server CA certificate at `serverCaFile`; trust must be explicit. Put the owner-issued, 15-minute enrollment token in `enrollmentTokenFile`, owned by `cra-agent`, mode 0600. Make the configured source readable by that account without granting write access. The service needs no root, Docker socket, shell endpoint, or privileged network capability.

```sh
sudo -u cra-agent node /opt/cra-agent/current/dist/main.js enroll --config /etc/cra-agent/config.json
sudo systemctl enable --now cra-agent
sudo -u cra-agent node /opt/cra-agent/current/dist/main.js status --config /etc/cra-agent/config.json
```

Enrollment generates an EC P-256 private key and CSR locally, fsyncs the exact CSR for retry, exchanges the token over trusted TLS, then stores the client certificate and isolated HMAC key in `/var/lib/cra-agent/credentials.json` (0600). The enrollment token, CSR, and temporary key are removed after a durable credentials write. The agent never logs keys, token values, source bodies, or request URLs. Protect the state volume with host disk encryption and backup access controls.

## Sources and egress

The file adapter accepts newline-delimited JSON, with each complete line matching `connectorExternalRecordSchema`. It checkpoints the file device, inode, and byte offset; replacement or truncation stops ingestion for reconciliation. Partial lines wait for completion. Up to 200 records and at most `maxReadBytes` are read per page; the signed frame is capped at 4 MiB.

The HTTPS adapter issues GET to the exact configured HTTPS host. Every resolved address must appear in `allowedAddresses`; redirects, non-200 responses, invalid cursors, untrusted TLS, and oversized pages fail closed. Its canonical response is `{ "records": [...], "nextCursor": "opaque-token" }`; a nonempty page must return a new non-null cursor. Source URLs cannot carry inline credentials or query parameters. Authorization is read from a 0600 `authorizationFile`, not stored in the config. A `caFile` can pin a customer source CA.

Allow outbound TCP from the agent to the CRA ingress HTTPS port (usually 3443) and, for HTTPS sources, the approved source port. No inbound firewall rule or VPN is required. Optional `proxyUrl` supports an HTTP CONNECT proxy to CRA; it must pass TLS and client certificates through without interception. DNS and certificate validation still apply at the agent. The source HTTPS adapter connects directly to its pinned resolved address. If policy requires a source proxy, arrange the export as a local file until that proxy is reviewed.

## Delivery, rotation, and recovery

The SQLite queue uses WAL and FULL sync. A source page and its cursor metadata are encrypted with AES-256-GCM before any POST. The accepted checkpoint advances only after a matching durable CRA batch ACK; replay history stores keyed cursor fingerprints. A timeout or `backpressure` leaves the same batch ID pending and retries it with a new signed nonce and exponential delay, capped at one minute. The queue accepts at most one pending page for this connector. `maxQueueBytes` bounds pending plaintext, and SQLite page count plus a conservative `2 × maxQueueBytes + 8 MiB` database/WAL budget stops new ingestion before exhaustion; emergency SQLite `SQLITE_FULL` also leaves the checkpoint untouched. Reserve filesystem headroom for temporary WAL/SHM overhead and backups. ACKs checkpoint and truncate WAL. Repeated HTTPS cursor tokens are rejected within the last 1,024 accepted pages; older opaque token uniqueness remains a source contract.

The agent rotates its certificate/HMAC material seven days before expiry and retains the pending CSR and idempotency key across restart. Operators can run `rotate --config ...` manually. If credentials expire before rotation, or are revoked, create a new on-premises connector and obtain a fresh scoped enrollment from a CRA owner; the old connector keeps its audit and staged evidence. Clock skew over the server's ±120-second window requires host time synchronization; investigate NTP before retrying. Revocation stops new accepted frames without deleting local queued evidence.

Back up the entire private state directory, including `queue.sqlite`, its WAL/SHM files, `queue.key`, credentials, and any pending rotation files, while the service is stopped or using a consistent volume snapshot. Restore as a unit with owner `cra-agent` and mode 0700/0600. Do not restore only the queue without its encryption key. After restore, the agent resends unacknowledged batches with their original batch IDs; CRA returns the existing ACK for a matching committed batch. Verify backlog and last contact in the connector detail page before resuming source exports.

To uninstall, run `sudo sh /opt/cra-agent/current/deploy/uninstall.sh`. This removes the service unit and current symlink. Config, versioned releases, state, queued pages, and retained evidence remain until an authorized operator explicitly archives or removes them. Preserve source exports and CRA sync-run/audit records under the customer's retention policy.

## Operational checks

- `systemctl status cra-agent` and `journalctl -u cra-agent` show only safe error codes; the CRA connector detail shows last contact, capabilities/version, backlog, and staged pages.
- `queue_full`: increase approved disk capacity or resolve CRA backpressure; never delete the queue to clear the alert.
- `source_changed` or `source_invalid`: freeze ingestion, compare export identity/cursor and schema with the customer, then reconcile via the connector dry-run before changing the source.
- `network_unavailable`, `proxy_failed`, or `tls_failed`: confirm egress, CONNECT pass-through, DNS allowlist, CA bundle, and mTLS certificate validity.
- `clock_skew` or `credential_expired`: correct time, rotate, or have a CRA owner issue a new enrollment. Do not bypass verification.

The agent does not establish exactly-once delivery to an external system. CRA stages idempotently and commits through its existing sync transaction; internal source export fidelity and customer PLM schema semantics remain deployment-specific.

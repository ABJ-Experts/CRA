# Playwright MCP retest — 2026-10-07

The configured Codex Playwright connection still returned `Transport closed`. A separate, owned local MCP session was started using the already cached `@playwright/mcp@0.0.82` launcher. Its server identified itself as Playwright `1.64.0-alpha-1789764292000`. Standard MCP initialization/tools discovery and `browser_navigate` succeeded; testing used `browser_run_code_unsafe` through its local streamable HTTP endpoint, not the standalone test runner.

## Isolation and running services

- CRA web: `http://localhost:3101`, separate Next output directory, mocks disabled.
- CRA fixture API: `http://127.0.0.1:3334`, real authentication/database, owned TLS collector, test-only loopback transport adapter, outbound network restricted to loopback.
- Owned Playwright MCP: `http://localhost:8945/mcp`, headless Chrome, isolated in-memory browser profile, CRA/fixture origins explicitly allowed.

No existing MCP processes were restarted or killed, and no global MCP configuration was changed. Other sites' browser profiles, cookies and storage were untouched. Only the access cookie in the owned isolated CRA context was cleared to exercise refresh. These three test services were left running at the user's request. Production public endpoint restrictions remain unchanged; the collector is a controlled test fixture.

## Passed checks

| Check | Observed result |
| --- | --- |
| HTTPS JSON and CEF | Collector accepted both formats |
| TLS syslog JSON and CEF | Sent, receipt unconfirmed in both formats |
| Credentials | Inputs cleared after rotation; screenshots captured after clearing |
| Reviewed replay | Linked replay preserved the original event identity |
| Session refresh | Narrow refresh-cookie path retained; mounted GET polling refreshed successfully |
| Restricted viewer | Audit/connector read returned 403 and the forbidden UI appeared |
| Organization switch | Destination/replay state cleared; original organization restored |
| Collector HTTP 429 | Durable attempt recorded and public state reported `retrying` |
| Recovery | Automatic retry accepted after fixture restoration; delivery and event IDs unchanged |
| Final state | Owned destination disabled, zero pending deliveries |

Read-only Supabase MCP reconfirmed local CRA `http://127.0.0.1:54321`. The owned fixture destination had seven retained 429 attempt records across the smoke runs, including one delivery that subsequently accepted. Earlier extra smoke assertions used the internal queue label and an exact table-cell text match; they were corrected to the public retrying state/row including its safe failure code. Their cancelled fixture records remain retained. No application changes were needed.

## Screenshot capture record

The eight generated screenshots were removed at the user's request during repository cleanup. The capture and verification results below remain recorded.

- HTTPS JSON (generated artifact removed during repository cleanup)
- HTTPS CEF (generated artifact removed during repository cleanup)
- TLS syslog JSON (generated artifact removed during repository cleanup)
- TLS syslog CEF (generated artifact removed during repository cleanup)
- Reviewed replay (generated artifact removed during repository cleanup)
- Forbidden viewer (generated artifact removed during repository cleanup)
- Rate limited (generated artifact removed during repository cleanup)
- Recovered and disabled (generated artifact removed during repository cleanup)

Session summaries: `/tmp/cra-m13-05-mcp-result.json` and `/tmp/cra-m13-05-mcp-outage-result.json`. Credential-bearing MCP code echoes were not printed or saved; raw headers/tokens/private keys were not included in evidence. Existing implementation capacity limits remain as documented in the [completion record](../m13-05-siem-forwarding.md).

The final MCP screenshot command succeeded after recovery/disable. MCP console inspection reported zero errors and zero warnings in the active page.

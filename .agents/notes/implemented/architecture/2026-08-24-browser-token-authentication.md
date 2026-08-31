# Agent Note: Browser launch-token authentication

Status: implemented

English | [中文](2026-08-24-browser-token-authentication.zh.md)

## Problem

The Web Host runs tool-capable Sessions with the current operating-system user's authority, but its HTTP interface identified privileged callers from request routing facts. In particular, the method-specific loopback list treated a loopback `Host` value as local authority even though an HTTP client controls that header. A caller that could reach the server could therefore name `localhost`, enter configuration methods, and use Host-side operations such as model discovery to disclose stored credentials. Binding the shipped CLI to loopback limits ordinary reachability but does not authenticate a request forwarded or otherwise delivered to that socket.

## Decision

`dsh-client-connection` authenticates the complete Host API before dispatch. Every API Proxy method, Remote unary call, generic Connection channel, and Remote WebSocket stream requires the same browser session; endpoint ownership and method names do not alter authority. The existing Host/Origin checks run first and retain their DNS-rebinding and cross-site-request role, returning 403 when they fail. A trusted Host without a valid browser session receives 401. The browser-trust rules remain owned by the [carrier-level browser trust decision](2026-07-28-api-browser-trust-boundary.md).

Each Harness home keeps one durable launch token beside its signing secret, so restarts reuse it instead of rotating: operators and scripts address the server by one stable URL and read the token from a fixed file. Connection reuses the token across hot reloads and process restarts alike; deleting the credential record remains the rotation path. `dsh-web-app` prints and opens the normal root URL with that token in the query once per process. `frontend-static` asks Connection to authorize index responses: only `GET /?token=...` exchanges the token for a cookie, then redirects to clean `/`; the token is not accepted on API paths or in an Authorization header. A mismatched token paired with a valid cookie redirects to clean `/`. Missing and invalid credentials receive one minimal 401 response. Static non-index assets remain public.

The cookie is a signed, authority-bound bearer. Its deterministic name and signed payload both include the normalized hostname plus port, so one Harness home can run independent Web ports without cookie collisions. The payload carries safe-integer issue and expiry times under an absolute lifetime; `cookieMaxAgeDays` defaults to 30. The cookie is host-only, `Path=/`, `HttpOnly`, and `SameSite=Strict`. It omits `Secure` because the shipped server uses loopback HTTP. There is no logout operation or reverse-proxy-specific handling.

The HMAC secret and the launch token live together in a versioned `grant` record at `client-connection/browser-session` in `ctx.credentials`; the local provider stores it in `$DSH_HOME/.credentials.yaml`. Payload version 2 carries both values; a version-1 record upgrades in place, keeping its secret so existing cookies survive. Connection loads or creates the record during activation and retains both values for synchronous request verification. Every activation also re-records the plain token at the fixed Harness-home path `$DSH_HOME/web-token` (mode 0600, best effort — a failed write is reported and never blocks the server), so scripts and probes read the token from the filesystem instead of parsing process output. An active Connection continues using its loaded values if the durable record changes; the next activation loads the replacement or creates a missing record, so deleting the record and restarting the process revokes every existing cookie and rotates the token. Invalid owner payloads fail loud instead of being replaced. An unexpired cookie remains valid across restarts on the same authority.

The in-page Web Worker preview exposes no network socket. Its page-owned `postMessage` tunnel enters the real route first, then retries a 401 or 403 through the worker-local fetch handler. This keeps Connection interceptors while limiting the authentication bypass to the page that created the Host worker.

The shipped CLI continues to reject `--host 0.0.0.0`. Authentication does not imply supported network deployment, TLS, forwarding-header interpretation, or proxy configuration.

## Verification

Unit coverage pins one durable token shared by every activation, the fixed token-file record with its 0600 mode, best-effort continuation when the file cannot be written, one secret load per activation, synchronous verification without credential-provider reads, cookie attributes, HMAC and payload validation, authority and lifetime checks, record deletion taking effect on the next activation, the in-place version-1 upgrade that keeps the secret, invalid durable records, and cleanup of mismatched token URLs backed by valid cookies. Host transport suites pin uniform 401/403 behavior for generic RPC, Typert Remote HTTP, exact Fetch routes, and WebSocket upgrade paths. The frontend real-composition test boots credentials, Connection, webserver, and static serving through Loader and proves token exchange before index reads while static assets remain public. Packed-worker tests prove portable cookie encoding and worker-local retry for both authentication and trust rejection. A real-CLI test starts `dsh web` twice on one port with a temporary `DSH_HOME`, proves that forged `Host: localhost` is unauthenticated, calls `settings/describe` with the exchanged cookie, observes the same launch token and recorded token file after restart, and reuses the old cookie.

## Alternatives considered

**Determine privileged callers from the TCP peer address.** A direct peer address still identifies a local forwarding process rather than the browser user, retains a second authority model beside the API's command-execution capability, and requires proxy policy to answer who the original caller was. One application credential is the enforceable identity used for every operation.

**Keep a method-specific privileged list and restrict stored credentials to configured targets.** The list can omit new endpoints and does not constrain callers that already control a tool-capable Session. A `discoverModels` target rule would not form a security boundary because the same authenticated principal can update settings and run commands. Uniform authentication covers the operation that grants process control.

**Persist the launch token, but never accept it as an API bearer.** Upstream originally rotated the token every process start and rejected persistence because a durable token becomes a second long-lived credential. This Harness fork deliberately chooses durability: one stable launch URL and a fixed token file outweigh per-process rotation for a development harness whose home directory already guards the equivalent signing secret at the same trust level. The token still performs one browser-cookie exchange only — no Authorization-header support, no non-browser client contract.

**Rotate the signing secret on every restart.** This prevents an existing browser from reconnecting after an ordinary DSH restart. Persisting only the signing secret keeps that workflow while process-token rotation limits the startup URL to one process lifetime.

**Add logout, TLS-proxy, and forwarding-header configuration.** None is required by the loopback Web application or the reported authentication gap. Adding them would define deployment contracts without current consumers. Browser site-data controls revoke one browser session; deleting the credential record and restarting the process revokes all sessions.

## Consequences

Possession of the browser cookie authorizes the complete tool-capable Host API, matching the authority the Web application exposes after Session creation. `Host` does not grant a higher method tier, and a method migration between API Proxy and Typert Remote cannot change its caller set.

The persistent secret makes cookies survive restarts but gives a stolen cookie up to the configured absolute lifetime; the durable launch token lives at the same trust level in the same record and file. Deleting the record and restarting the process is the global revocation mechanism and rotates the token with the secret; the active Connection intentionally avoids credential-provider work on each request. Omitting `Secure` preserves loopback HTTP and permits plaintext transmission if an operator makes the same cookie authority reachable over an unencrypted network. The startup URL and the recorded `web-token` file contain a durable credential and must be treated as sensitive output; runtime diagnostics do not repeat the URL, and the file is written 0600.

The decision partially supersedes the authentication deferral and unauthenticated non-loopback consequences in the [browser trust note](2026-07-28-api-browser-trust-boundary.md). That note remains active authority for media-type, Host, Origin, Fetch-Metadata, and configured-authority validation. No active Agent Note is archived: the overlap is partial and both security rules retain future decision value.

# Agent Note: Domain-claimed blank sessions stay visible and are never reused by New Session

Status: implemented

English | [中文](2026-08-19-domain-claimed-blank-sessions.zh.md)

## Problem

A blank session (no `turn/start` yet) is reused by the New Session flow and hidden from grouping surfaces unless current. Domains that claim a session before its first turn — Emergency Harness registers an event draft on a blank session so members can be configured ahead of the first prompt — broke both rules: New Session silently landed the user on an event draft, and the draft vanished from the workspace tree as soon as the user navigated away.

## Decision

The existing `sessionVisibility` resolver (`ui-workspace` tree) doubles as the domain claim: a blank session whose verdict is `'visible'` is domain-owned. `WorkspaceRuntime.connectWorkspace` consults the same optional service and skips claimed blanks in its reuse scan, so New Session mints a fresh ordinary session instead of recycling a claimed one. No new service is introduced; a domain provides one resolver and gets both behaviors. Emergency Harness provides the resolver from its event registry, so an event draft stays in the tree (with its badge) from creation until first prompt, and the native New Session button needs no interception.

## Alternatives considered

**Intercept the native New Session click in the domain plugin.** A capture-phase DOM listener can reroute the gesture, but it fights the framework default, breaks whenever the button's markup or locale changes, and cannot cover the other reuse entry points (workspace connect). Rejected.

**Register the event only on the first prompt.** Deferred registration keeps blanks untouched, but member configuration must then live in a parallel client-side store and be materialized at submit — a second creation flow with orphan role sessions on abandonment. Rejected.

**Flip the blank bit with a marker session event.** The list projection clears `blank` only on `turn/start`; plugin events deliberately do not count, and faking a turn would corrupt the trajectory. Rejected.

## Testing

`packages/client/runtime/tests/workspaces-service.client.spec.ts` covers the reuse scan skipping a claimed blank (falls through to an ordinary member blank, and mints when only the claimed blank exists). Existing reuse, archive, and stray-cwd cases keep passing. EH verifies the click flows with Playwright.

## Consequences

`sessionVisibility` is now load-bearing for two behaviors; a resolver verdict of `'visible'` for a blank session means "domain-owned, hands off New Session". Domains that only want tree visibility without reuse exclusion have no separate knob — none is needed today. The host-side blank definition is unchanged.

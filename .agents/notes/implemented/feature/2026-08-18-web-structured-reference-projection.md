# Agent Note: Web projects structured references without exposing wire identity

Status: implemented

English | [中文](2026-08-18-web-structured-reference-projection.zh.md)

## Problem

Emergency Harness location references entered the composer as a raw `EH_LOCATION_V1` string shown in a dock, while user, assistant, and team history each used unrelated text or button rendering. Storage ids and source-session ids could consequently appear in visible labels, and a displayed dock token was not an input-machine occurrence, so submit serialization had no durable ownership or failure behavior.

## Decision

`ui-primitives` owns the pure structured-reference parser, display formatter, clipboard projection, `ReferenceChip`, and `ReferenceText`. New wire values use `[[EH_REF_V1:{...}]]` with `{ kind: 'location' | 'asset' | 'issue' | 'fact', id?, name?, location?, time? }`; history also parses `EH_LOCATION_V1`. Malformed tokens remain literal text. Display and clipboard labels ignore `id`; a named location shows its name followed by longitude and latitude at exactly six decimals, then optional formatted time.

The conversation input action face exposes `appendReference`. It creates the existing U+FFFC occurrence at the draft tail and leaves model serialization to the registered source codec. Emergency Harness registers `eh-reference`, stores the envelope JSON in `ReferenceInsert.ref`, caches the display-safe label for the composer and clipboard, and serializes only at submit. The composer therefore uses InputBar's native occurrence chip and has no parallel dock preview.

User and assistant text renderers call `ReferenceText` at their existing text seams. Emergency Harness team messages use the same primitive for body tokens, explicit refs, and locations. The wire token and storage identity remain in logged/model text where required but never become visible chip content.

## Alternatives considered

**Keep the dock token and transform the draft on submit.** This would create a second input state outside `InputState.occurrences`, losing native undo, copy, invalid-owner, and serialization-failure semantics.

**Implement separate renderers in Emergency Harness.** This would let user, assistant, and team labels drift and would keep native history unaware of legacy persisted tokens.

**Use `id` when a display name is absent.** Storage ids are not user labels. The formatter uses a kind-specific fallback instead, while the complete id may remain in the wire envelope.

## Testing

`ui-primitives` tests parser, legacy compatibility, malformed input, six-decimal location labels, time, clipboard projection, and id hiding. `ui-conversation` tests public occurrence insertion, codec serialization, and user/assistant history. `ui-workspace` tests event metadata and the local Calendar SVG. Emergency Harness source/bundle verification and Playwright cover team chips plus the map-to-composer-to-history path.

## Consequences

All four reference kinds share one display and clipboard contract across composer and transcript. A plugin that inserts a structured occurrence must register a codec; missing or failed serialization retains the draft instead of sending clipboard text. Splitting assistant Markdown around a reference token intentionally limits Markdown syntax from spanning across that token.

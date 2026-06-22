# 0001 — Page-owned readiness for multi-page scraping

- **Status:** Accepted
- **Date:** 2026-06-21
- **Area:** extension (`apps/extension` — `background/tabs.ts`, `retailers/*/adapter.ts`, `entrypoints/*.content.ts`, `lib/dom-wait.ts`)

## Context

Scraping a retailer means walking many pages in one tab: transactions list →
order #1 detail → order #2 detail → next page → … Two facts about browser
extensions constrain any design here:

1. **A content script dies on every navigation.** Nothing running inside a page
   survives to the next page, so the actor driving a multi-page walk must live
   *outside* any page — the background context (a service worker on Chrome MV3, a
   persistent background page on Firefox MV2).
2. **Navigation and tab control are privileged.** `browser.tabs.update` and
   tab-opening are unavailable to content scripts; only the background context
   can navigate the tab.

So a background coordinator is not a choice — without it there is no multi-page
walk, and it is the only actor allowed to navigate.

The earlier design coupled each action to its reply: the background sent a
"scrape" or "next page" message and awaited the response. This hung whenever the
action navigated, because the navigation destroyed the content script
mid-reply — the reply never came. The worst cases were Amazon's Firefox pager
(a full same-URL reload each turn that drops the message channel) and a Target
step-up wall hit mid-walk (the awaited reply never arrived → 30s hang). We
accumulated bandaids (channel-error sniffing, recovery dances, ping-polling as
the readiness signal) that each addressed a symptom.

## Decision

**The page owns readiness, navigation-detection, and parsing. The coordinator
triggers an action, then awaits the *next* matching result — never the reply to
the action itself.**

- A content script classifies its own page from the URL (`detectPageKind`, pure,
  in `retailers/*/page.ts`), waits for *its own* DOM to be ready using shared
  primitives (`lib/dom-wait`: `waitUntil`, `waitForElement`, `waitForQuietDom`),
  parses, and sends exactly one semantic `PAGE_RESULT`.
- The coordinator (`background/tabs.ts`) triggers an action — `navigate`
  (`tabs.update`) or an in-page command (`sendMessage`: `DESCRIBE`/`NEXT_PAGE`/
  `LOAD_MORE`) — all **fire-and-forget**, then calls
  `awaitPageResult(tabId, predicate)` for the next result matching what it
  expects.
- Adapters (`retailers/*/adapter.ts`) own the walk: trigger, await the matching
  result, build matched orders, handle blocks.

Two consequences fall out for free:

- **A navigation / content-script teardown is a non-event.** The coordinator
  holds no promise tied to the dead script; whichever page loads next describes
  itself and the await resolves on it.
- **An auth/step-up wall is an ordinary result.** A sign-in page reports
  `{ pageKind: "login" }`; the adapter returns a clean `signed_out` (Amazon) /
  `step_up` (Target) block **with partial results**, instead of hanging.

### The coordinator is ~40 lines doing one job

Route the page's next fact to whoever is waiting, and don't lose it if the fact
arrives a beat early:

- `runtime.onMessage` listener (`initPageResultListener`, registered **once** at
  startup so a result from the very first page load can't be missed) — keys each
  `PAGE_RESULT` by `sender.tab.id`.
- A **waiter map**: `awaitPageResult` parks a promise + predicate; the listener
  resolves the first matching waiter. This *is* the "await the next result"
  primitive.
- A **single-slot buffer**: if a result arrives before any waiter is parked
  (the cold-start / fast-reload race — the page boots and describes itself
  faster than the adapter can re-park), it's stashed so the imminent
  `awaitPageResult` picks it up instead of timing out. ~10 lines insuring against
  the exact hang class this rewrite eliminated.

## Alternatives considered

- **Drive the walk from the content script.** Impossible — dies on navigation,
  can't navigate.
- **Keep awaiting the action's reply** (the prior design). This is what hung on
  navigation and on step-up walls.
- **Drop the buffer; register a one-shot `onMessage` listener inside each
  `awaitPageResult`.** Looks simpler but has the *identical* race (a message
  arriving before the listener registers is missed) with no buffer to catch it —
  it re-opens the hang for ~10 fewer lines. Rejected.
- **Drop the buffer entirely (waiter map only).** Re-introduces the cold-start /
  fast-reload drop. Rejected.

## Consequences

- The coordinator never sniffs for channel errors or runs recovery dances; those
  bandaids were deleted (`isPageTurnChannelError`, `waitForTabLoad` recovery,
  `sendToTab`, ping-poll-as-primary-readiness).
- Readiness lives where the knowledge is (the page), so we observe the DOM
  settle instead of guessing with a fixed timeout — this fixed Target's Firefox
  under-collection (10 vs 20 orders).
- A 30s `awaitPageResult` timeout surfaces a real "page never reached the
  expected state" failure to the caller as partial results, not a silent hang.
- `PING`/`PONG` survives **only** as `openRetailerTab`'s first-load gate (confirm
  the content script is injected before the first `describe`); it is no longer
  the readiness mechanism for the walk.
- **Open follow-up:** MV3 service-worker durability — a long Chrome backfill can
  outlive the SW's lifetime. Tracked as BAC-150 (checkpoint + resume). The
  page-owned model is compatible with it; resume re-drives the walk and the
  idempotent backfill marker skips already-allocated orders.

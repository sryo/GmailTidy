# AGENTS.md

Implementation contracts for anyone (human or AI) working in this repo.
Read README.md first for product goals.

## Communication
- No em-dashes anywhere.
- Terse. WHAT + WHY, never HOW.
- Show previews for prose edits before applying.
- Refactor freely when it makes the code better.

## No magic numbers or strings
Every numeric constant or stringly-typed value (intervals, TTLs, thresholds,
limits, tracking types, source labels) lives in `_config.gs`. Use the named
constant in code, never the literal. Exception: Gmail system-label names
(`pinned`, `snoozed`, `done`, `low_priority`, `promos`) stay as literals in
queries since they're external to our schema.

## Minimum effort
"Minimum effort" means minimum imposition on Gmail. Add the fewest labels,
the smallest state, the simplest queries that get the job done. Don't pollute
the mailbox with bookkeeping the user has to maintain. The user wants a
self-running system, not an admin task.

## Triggers
- `cleanUp`: every 5 min. Fast Gmail bookkeeping only.
- `cleanUpDeep`: every 15 min. Riff + burndown-reply.
- `bunch`: every 5 min.
- `removeEmptyLabels`: every 30 min.
- `sendBurndown`: daily at `BURNDOWN_HOUR`.
- `dailyMaintenance`: daily at `TRIGGER_DAILY_MAINTENANCE_HOUR`. Tracking retention.

Routines inside `cleanUp`, in order: `markDoneAsRead`, `markPinnedAsImportant`, `salvagePretrashOnSignals_`, `deleteOlder`, `preTrashLowPriority`, `markTrashAsUnimportant`, `archiveDismissedPings_`, `archiveStalePings_`, `ping`, `syncManualPings_`, `stash`, `archiveInbox`.

Routines inside `cleanUpDeep`: `riff`, `processBurndownReplies_`.

Routines inside `dailyMaintenance`: `pruneTracking_`.

After changing any `TRIGGER_*_MIN` constant, re-run `install` (it always recreates triggers).

## User assumptions
The user expresses intent through Gmail's importance flag and the script-managed
labels. Manual gestures the system reads as signal:
- Mark **important** = "I want to see this."
- Mark **unimportant** = "I don't care."
- Remove **🗑️** = salvage; the thread should be kept.
- Star / apply **pinned** / **snoozed** = explicit positive.
- Apply **↩️** = reply later; thread returns to Hot and is tracked like an auto-ping.
- Remove **↩️** = dismiss a ping; the thread should be archived.
- Apply **🦾** = draft me a reply via LLM. Stays on the thread until the draft is sent or deleted.
- Apply **🫵** = voice corpus *and* hands-off marker: thread is excluded from auto-ping and auto-pretrash. The drafter still pulls 🫵-labeled sent emails as voice examples.

One-time setup: label a handful of your sent emails with **🫵** so the drafter has voice examples to mimic.

## Tracking sheet
A spreadsheet named `GmailTidy (<email>)` with one tab (`Tracking`) carries three orthogonal markers: pinged, drafted, burndown_processed (msgId-keyed dedup for the burndown reply parser). That's the only state the script persists outside Gmail itself.

## Contracts
- Gmail's `is:important` flag is the source of truth. The script never flips it.
- Pretrash is category-based (`low_priority` OR `promos` OR `category:updates`), not generic `is:unimportant`.
- Pinned threads are always promoted to important.
- Stash requires `is:important has:attachment`.
- Bunch only labels importants.
- Ping is one-shot per thread. Tracking row is permanent.
- Manually applied ↩️ is treated like an auto-ping (moved to inbox, tracked).
- If ↩️ is applied to a pretrashed thread (🗑️), the 🗑️ is stripped (salvage override).
- If a 🗑️ thread becomes starred, important, replied-to (`label:sent`), or labeled 🦾 or ↩️, the 🗑️ is stripped on the next cleanUp.
- Script archives a thread when its ↩️ label is removed.
- Stale pings (older than PING_EXPIRE_DAYS) archive passively.
- Script drafts a reply on 🦾-labeled threads using up to VOICE_EXAMPLES_MAX sent emails labeled 🫵 as few-shot.
- The 🦾 label stays until the draft is sent or deleted by the user; only then does the script remove it.
- A pretrashed thread (🗑️) carries no other labels; entry points strip them.
- Burndown sends one self-mail digest per day listing important unread unreplied threads with Riff drafts as suggestions; the user's reply to that digest is parsed into per-thread drafts (or sends, if `BURNDOWN_AUTOSEND`).
- Each user reply to a burndown is processed at most once, keyed by message ID via `TRACKING_TYPE_BURNDOWN_PROCESSED`.

## Known limitations (accepted, not bugs)
- GmailApp.search caps at 500. Backlogs catch up over subsequent runs.
- Apps Script doesn't serialize triggers. No LockService.

## Decided against
- LLM flagging of mail importance (tried, removed; the classifier never beat Gmail's own call).
- Per-domain labels on unimportants.
- LockService for cleanUp concurrency.

## Vocabulary
Hot, Meh, Ping, Bunch, Stash borrowed from [Posta](https://sryo.github.io/Posta/).
Burndown is the daily reply-triage digest.

## Constants
All in `_config.gs`. Time windows, TTLs, search batch limits.

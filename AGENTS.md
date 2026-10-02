# AGENTS.md

Implementation contracts for anyone (human or AI) working in this repo.
Read README.md first for product goals.

## Goals
- Self-running: zero upkeep. One failing routine never stops the rest.
- Gmail is the UI: intent comes from Gmail gestures, no settings.
- Reversible: pretrash before trash; every action can be undone by a gesture.
- Inspectable: every action traces to a signal visible in Gmail.
- Assist, don't act: LLM output is drafts; autosend is opt-in.
- Maintainable: small, readable code. Prefer deleting code to adding it.

## Communication
- No em-dashes anywhere.
- Terse. WHAT + WHY, never HOW.
- Show previews for prose edits before applying.
- Refactor freely when it makes the code better.

## No magic numbers or strings
Every numeric constant or stringly-typed value (intervals, TTLs, thresholds,
limits, tracking types, source labels) lives in `_config.gs`. Use the named
constant in code, never the literal. Exception: Gmail system-label names
(`pinned`, `snoozed`, `done`, `low_priority`, `promos`, `inbox`, `sent`, `trash`,
`starred`, `category:updates`) stay as literals in
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

Routines inside `cleanUp`, in order: `markDoneAsRead`, `markPinnedAsImportant`, `blockHandTrashedSenders_`, `salvagePretrashOnSignals_`, `archivePretrash_`, `deleteOlder`, `preTrashLowPriority`, `keepNewest_`, `markTrashAsUnimportant`, `dismissMutedPings_`, `archiveDismissedPings_`, `archiveStalePings_`, `ping`, `nudge`, `syncManualPings_`, `stash`, `archiveInbox`.

Routines inside `cleanUpDeep`: `riff`, `processBurndownReplies_`.

Routines inside `dailyMaintenance`: `pruneTracking_`.

`cleanUp`, `bunch` and `removeEmptyLabels` use the Advanced Gmail API (`_gmail.gs`), not GmailApp: GmailApp's daily call quota is small and shared by the whole script, and every routine fails once it runs out.

After `clasp push`, run `clasp redeploy <id>` on the deployment described `Public` (see `clasp deployments`) so the 🌎 page serves the new code at the same URL.

After changing any `TRIGGER_*_MIN` constant, re-run `install` (it always recreates triggers).

## User assumptions
The user expresses intent through Gmail's importance flag and the script-managed
labels. Manual gestures the system reads as signal:
- Mark **important** = "I want to see this."
- Mark **unimportant** = "I don't care."
- Apply **🗑️** by hand = block the sender: a Gmail filter sends their future mail to 🗑️. Delete the filter in Gmail Settings to unblock.
- Remove **🗑️** = salvage; the thread should be kept.
- Star / apply **pinned** / **snoozed** = explicit positive.
- Apply **↩️** = reply later; thread returns to Hot and is tracked like an auto-ping.
- Remove **↩️** = dismiss a ping; the thread should be archived.
- **Mute** = dismiss: a muted thread loses ↩️ and 🦾 and is never auto-pinged.
- Apply **🦾** = draft me a reply via LLM. If you sent last, the draft is a follow-up. Stays on the thread until the draft is sent or deleted.
- Apply **🌎** = publish this thread on the web page served by `doGet`. Remove it to unpublish.
- Apply **🫵** = voice corpus *and* hands-off marker: thread is excluded from auto-ping and auto-pretrash. The drafter still pulls 🫵-labeled sent emails as voice examples.

One-time setup: label a handful of your sent emails with **🫵** so the drafter has voice examples to mimic.

## Tracking sheet
A spreadsheet named `GmailTidy (<email>)` with one tab (`Tracking`) carries five orthogonal markers: pinged, drafted, burndown_processed (msgId-keyed dedup for the burndown reply parser), pretrashed, salvaged. Each expires per `TRACKING_TTL_DAYS_BY_TYPE`; salvaged never does. That's the only state the script persists outside Gmail itself.

## Contracts
- Gmail's `is:important` flag is the source of truth. The script flips it only to keep pinned/snoozed important and trashed or pretrashed unimportant.
- Pretrash takes any inbox thread not marked important. Mail from anyone you've written to (`label:sent to:`) is never auto-pretrashed.
- Recurring automated mail in `category:updates` without attachments (same sender, same subject with digits masked) keeps only its newest copy; older ones are pretrashed.
- A 🗑️ thread without a pretrashed row got it by hand or from a block filter; its sender gets a Gmail filter (add 🗑️, skip inbox, never important) once.
- Pinned threads are always promoted to important.
- Stash requires `is:important has:attachment`.
- Bunch only labels importants from the last `BUNCH_WINDOW_DAYS`, never by the user's own address.
- Ping is one-shot per thread: the ping window closes before its tracking row expires.
- Manually applied ↩️ is treated like an auto-ping (moved to inbox, tracked).
- Nudge pings a thread once when your last message, sent to someone else, has a `?`, carries no calendar invite, and got no answer for NUDGE_PICKUP_DAYS weekdays. It shares the pinged row, so its window closes before that row expires.
- If ↩️ is applied to a pretrashed thread (🗑️), the 🗑️ is stripped (salvage override).
- If a 🗑️ thread becomes starred, important, replied-to (`label:sent`), or labeled 🦾 or ↩️, the 🗑️ is stripped on the next cleanUp.
- Script archives a thread when its ↩️ label is removed.
- Pings archive passively PING_EXPIRE_DAYS after the ping was applied (not message age).
- Script drafts a reply on 🦾-labeled threads using up to VOICE_EXAMPLES_MAX sent emails labeled 🫵 as few-shot, plus up to PRIOR_REPLIES_MAX of your recent replies to the same sender, and your calendar's busy times for CALENDAR_LOOKAHEAD_DAYS so scheduling replies propose real slots.
- The 🦾 label stays until the draft is sent, the model declines, or its ping is dismissed or expires. A discarded draft is redrafted at a higher temperature, told to take a different angle.
- Removing 🗑️ by hand is remembered; that thread is never pretrashed again.
- "From me" is an exact match on the user's address or a Send-As alias.
- A pretrashed thread (🗑️) carries no other labels; entry points strip them.
- Burndown sends one self-mail digest per day listing important unread unreplied threads plus every ↩️ thread in the inbox, with Riff drafts as suggestions and a date-sorted Due list pulled from the threads; the user's reply to that digest is parsed into per-thread drafts (or sends, if `BURNDOWN_AUTOSEND`).
- Each user reply to a burndown is processed at most once, keyed by message ID via `TRACKING_TYPE_BURNDOWN_PROCESSED`.
- The 🌎 page renders live from Gmail and shows only 🌎-labeled threads, with scripts and remote images stripped. The web app deploys as "Execute as: Me", "Who has access: Anyone", described `Public`.
- The 🌎 page URL is mailed to the user once, on the first request to that URL.
- 🌎 threads are left out of the burndown.

## Known limitations (accepted, not bugs)
- GmailApp.search caps at 500. Backlogs catch up over subsequent runs.
- Apps Script doesn't serialize triggers. No LockService.
- Pretrash grace counts from message age, so old mail can be trashed on the next run.

## Conventions
- `cleanUp` runs each routine through `safely_`.
- GmailApp batch calls go through `inChunks_` (100-thread cap).
- Pure logic is tested: `node --test tests/`.

## Decided against
- LLM flagging of mail importance (tried, removed; the classifier never beat Gmail's own call).
- Per-domain labels on unimportants.
- LockService for cleanUp concurrency.

## Vocabulary
Hot, Meh, Ping, Bunch, Stash borrowed from [Posta](https://sryo.github.io/Posta/).
Burndown is the daily reply-triage digest.

## Constants
All in `_config.gs`. Time windows, TTLs, search batch limits.

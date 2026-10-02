/*
Fast pass: labels, archives, ping, stash.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function cleanUp() {
  safely_('markDoneAsRead',            markDoneAsRead);
  safely_('markPinnedAsImportant',     markPinnedAsImportant);
  safely_('filterHandTrashedSenders_',  filterHandTrashedSenders_);
  safely_('salvagePretrashOnSignals_', salvagePretrashOnSignals_);
  safely_('archivePretrash_',          archivePretrash_);
  safely_('deleteOlder',               deleteOlder);
  safely_('preTrashLowPriority',       preTrashLowPriority);
  safely_('keepNewest_',               keepNewest_);
  safely_('markTrashAsUnimportant',    markTrashAsUnimportant);
  safely_('dismissMutedPings_',        dismissMutedPings_);
  safely_('archiveDismissedPings_',    archiveDismissedPings_);
  safely_('archiveStalePings_',        archiveStalePings_);
  safely_('ping',                      ping);
  safely_('nudge',                     nudge);
  safely_('syncManualPings_',          syncManualPings_);
  safely_('stash',                     stash);
  safely_('archiveInbox',              archiveInbox);
}

function archiveInbox() {
  const ids = searchIds_('label:inbox is:read older_than:' + ARCHIVE_INBOX_AGE_DAYS + 'd -label:pinned -label:snoozed -label:"' + LABEL_PING + '" -label:"' + LABEL_AUTOREPLY + '"');
  if (ids.length === 0) return;
  console.log('📦 Archiving ' + ids.length + ' read threads' + subjects_(ids));
  modifyThreads_(ids, [], ['INBOX']);
}

function ping() {
  const pinged = trackingIndex_(TRACKING_TYPE_PINGED);
  const candidates = searchIds_('is:read older_than:' + PING_PICKUP_DAYS + 'd newer_than:' + PING_EXPIRE_DAYS + 'd -label:sent -is:muted -label:done -label:pinned -label:snoozed -label:"' + LABEL_PING + '" -label:' + LABEL_PRETRASH + ' -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_VOICE + '" -in:trash')
    .filter(id => !pinged[id] && getThread_(id).messages.length === 1);
  if (candidates.length === 0) return;
  console.log('↩️ Pinging ' + candidates.length + ' forgotten reads' + subjects_(candidates));
  applyPingTo_(candidates, [labelId_(LABEL_PING)]);
}

// Your unanswered question comes back as a ping; Riff drafts the follow-up.
function nudge() {
  const pinged = trackingIndex_(TRACKING_TYPE_PINGED);
  const candidates = searchIds_('label:sent older_than:' + NUDGE_PICKUP_DAYS + 'd newer_than:' + NUDGE_WINDOW_DAYS + 'd -filename:ics -is:muted -label:done -label:pinned -label:snoozed -label:"' + LABEL_PING + '" -label:' + LABEL_PRETRASH + ' -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_VOICE + '" -in:trash')
    .filter(id => {
      if (pinged[id]) return false;
      const last = getThread_(id).messages.filter(m => !m.draft).pop();
      return last && isFromMe_(last.from) && !isFromMe_(last.to)
        && businessDaysSince_(last.date, Date.now()) >= NUDGE_PICKUP_DAYS
        && stripQuotedReplyHistory_(plainBody_(last.id)).includes('?');
    });
  if (candidates.length === 0) return;
  console.log('↩️ Nudging ' + candidates.length + ' unanswered questions' + subjects_(candidates));
  applyPingTo_(candidates, [labelId_(LABEL_PING)]);
}

// Mute is Gmail's "I'm done with this conversation"; treat it as dismissing the ping.
function dismissMutedPings_() {
  const ids = searchIds_('is:muted (label:"' + LABEL_PING + '" OR label:"' + LABEL_AUTOREPLY + '")');
  if (ids.length === 0) return;
  console.log('🔇 Dismissing ' + ids.length + ' muted pings' + subjects_(ids));
  modifyThreads_(ids, [], [labelId_(LABEL_PING), labelId_(LABEL_AUTOREPLY), 'INBOX']);
}

function salvagePretrashOnSignals_() {
  // Documented contract: star, important, reply, 🦾, ↩️ all signal KEEP.
  // Strip 🗑️ as soon as any of those appear so deleteOlder doesn't trash a thread the user revived.
  // label:sent (not from:me): from:me false-matches forwarded mail from Send-As aliases.
  const ids = searchIds_('label:' + LABEL_PRETRASH + ' (is:starred OR is:important OR label:sent OR label:"' + LABEL_AUTOREPLY + '" OR label:"' + LABEL_PING + '")');
  if (ids.length === 0) return;
  console.log('🗑️ Salvaging ' + ids.length + ' pretrashed threads with KEEP signals' + subjects_(ids));
  modifyThreads_(ids, [], [labelId_(LABEL_PRETRASH)]);
}

// A new message on a 🗑️ thread brings it back to the inbox; the label still says it belongs in pretrash.
function archivePretrash_() {
  const ids = searchIds_('in:inbox label:' + LABEL_PRETRASH);
  if (ids.length === 0) return;
  console.log('🗑️ Archiving ' + ids.length + ' pretrashed threads back in the inbox' + subjects_(ids));
  modifyThreads_(ids, [], ['INBOX']);
}

function syncManualPings_() {
  // Detects threads the user labeled ↩️ themselves and treats them like an auto-ping.
  // A manual ↩️ on a 🗑️ thread is a salvage; salvagePretrashOnSignals_ strips 🗑️ earlier in the same pass.
  const pinged = trackingIndex_(TRACKING_TYPE_PINGED);
  const untracked = searchIds_('label:"' + LABEL_PING + '" -in:trash').filter(id => !pinged[id]);
  if (untracked.length === 0) return;
  console.log('↩️ Syncing ' + untracked.length + ' manually pinged threads' + subjects_(untracked));
  applyPingTo_(untracked);
}

// Every ping, auto or manual, gets a Riff draft and returns to the inbox.
function applyPingTo_(ids, extraLabelIds = []) {
  modifyThreads_(ids, extraLabelIds.concat(labelId_(LABEL_AUTOREPLY), 'INBOX'), []);
  safely_('ping track', () => recordTrackingRows(ids, TRACKING_TYPE_PINGED));
}

function archiveDismissedPings_() {
  // Dismissal: the user removes ↩️; its absence on a tracked thread is the gesture. A reply that
  // arrived after the ping is new mail, not a dismissal, so that thread stays.
  const pingedAt = trackingTimes_(TRACKING_TYPE_PINGED);
  if (Object.keys(pingedAt).length === 0) return;
  const toArchive = searchIds_('in:inbox -label:"' + LABEL_PING + '"')
    .filter(id => pingedAt[id] && !hasIncomingSince_(getThread_(id), pingedAt[id]));
  if (toArchive.length === 0) return;
  console.log('📦 Archiving ' + toArchive.length + ' dismissed pings' + subjects_(toArchive));
  modifyThreads_(toArchive, [], [labelId_(LABEL_AUTOREPLY), 'INBOX']);
}

function archiveStalePings_() {
  // Passive dismissal: ↩️ still on PING_EXPIRE_DAYS after the ping. Aged by the ping row, not by
  // message dates, so a manual ↩️ on an old thread gets its full window.
  const pingedAt = trackingTimes_(TRACKING_TYPE_PINGED);
  const cutoff = Date.now() - PING_EXPIRE_DAYS * MS_PER_DAY;
  const ids = searchIds_('label:"' + LABEL_PING + '" -in:trash').filter(id => pingedAt[id] < cutoff);
  if (ids.length === 0) return;
  console.log('📦 Archiving ' + ids.length + ' stale pings' + subjects_(ids));
  modifyThreads_(ids, [], [labelId_(LABEL_PING), labelId_(LABEL_AUTOREPLY), 'INBOX']);
}

function stash() {
  // Bucketed at MAX_THREADS_TAG per run; bigger backlogs catch up over subsequent cleanUp cycles.
  const ids = searchIds_('is:important has:attachment -filename:ics -label:"' + LABEL_STASH + '" -label:' + LABEL_PRETRASH + ' -in:trash', MAX_THREADS_TAG);
  if (ids.length === 0) return;
  console.log('🪎 Stashing ' + ids.length + ' important attachments' + subjects_(ids));
  modifyThreads_(ids, [labelId_(LABEL_STASH)], []);
}

function markDoneAsRead() {
  const ids = searchIds_('label:done is:unread -label:pinned -label:snoozed');
  if (ids.length === 0) return;
  console.log('📖 Marking ' + ids.length + ' done threads as read' + subjects_(ids));
  modifyThreads_(ids, [], ['UNREAD']);
}

function preTrashLowPriority() {
  // A previously pretrashed thread that lost 🗑️ without a KEEP signal was salvaged by hand:
  // remember it so it's never pretrashed again.
  const pretrashedAt = trackingTimes_(TRACKING_TYPE_PRETRASHED);
  const salvaged = trackingTimes_(TRACKING_TYPE_SALVAGED);
  // Inbox only: a mailbox-wide scan would fill SEARCH_MAX with old kept threads and miss new ones.
  const query = 'in:inbox -label:' + LABEL_PRETRASH + ' -is:important -label:pinned -label:snoozed -label:done -is:starred -label:sent -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_PING + '" -label:"' + LABEL_VOICE + '"';
  const candidates = searchIds_(query).filter(id => !salvaged[id]).map(getThread_);
  // Gmail sometimes marks real people unimportant; anyone you've written to stays,
  // remembered as salvaged so the thread isn't re-read every run.
  const fresh = candidates.filter(t => !pretrashedAt[t.id]);
  const kept = fresh.filter(t => hasWrittenTo_(senderOf_(t)));
  const newlySalvaged = candidates.filter(t => pretrashedAt[t.id]).concat(kept);
  const threads = fresh.filter(t => !kept.includes(t));

  if (newlySalvaged.length > 0) {
    console.log('🗑️ Remembering ' + newlySalvaged.length + ' salvaged threads' + subjects_(newlySalvaged));
    recordTrackingRows(newlySalvaged.map(t => t.id), TRACKING_TYPE_SALVAGED);
  }
  if (threads.length === 0) return;
  console.log('🗑️ Pretrashing ' + threads.length + ' low-priority threads' + subjects_(threads));
  pretrash_(threads);
}

// Pretrash carries only 🗑️. Unimportant so salvagePretrashOnSignals_ doesn't read Gmail's flag as a KEEP signal.
// Rows match labels exactly: a row without 🗑️ reads as a hand salvage, 🗑️ without a row as a hand-applied 🗑️.
function pretrash_(threads) {
  const pretrash = labelId_(LABEL_PRETRASH);
  const done = [];
  for (const t of threads) {
    const remove = t.labelIds.filter(id => id.startsWith(USER_LABEL_ID_PREFIX) && id !== pretrash).concat('INBOX', 'IMPORTANT');
    if (modifyThreads_([t.id], [pretrash], remove).length === 0) break;
    done.push(t.id);
  }
  recordTrackingRows(done, TRACKING_TYPE_PRETRASHED);
}

// Recurring automated mail (same sender, same subject once digits are masked): only the newest stays.
// Attachments are exempt so statements and invoices are never collapsed.
function keepNewest_() {
  const salvaged = trackingTimes_(TRACKING_TYPE_SALVAGED);
  const threads = searchIds_('category:updates -has:attachment -label:' + LABEL_PRETRASH + ' -is:starred -label:pinned -label:snoozed -label:sent -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_PING + '" -label:"' + LABEL_VOICE + '" -label:"' + LABEL_PUBLIC + '" -in:trash', KEEP_NEWEST_SCAN_LIMIT).map(getThread_);
  const seen = new Set();
  const older = [];
  threads.forEach(t => {
    const key = extractAddress_(t.messages[0].from) + '|' + recurringSubjectKey_(t.subject);
    if (seen.has(key)) {
      if (!salvaged[t.id]) older.push(t);
    } else {
      seen.add(key);
    }
  });
  if (older.length === 0) return;
  console.log('🗑️ Pretrashing ' + older.length + ' superseded copies' + subjects_(older));
  pretrash_(older);
}

function recurringSubjectKey_(subject) {
  return (subject || '').toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

// Applying 🗑️ by hand filters the sender: a Gmail filter (visible in Settings > Filters) sends their
// future mail to 🗑️. Any 🗑️ thread without a pretrashed row got it by hand or from such a filter.
function filterHandTrashedSenders_() {
  const pretrashedAt = trackingTimes_(TRACKING_TYPE_PRETRASHED);
  const threads = searchIds_('label:' + LABEL_PRETRASH + ' -in:trash').filter(id => !pretrashedAt[id]).map(getThread_);
  if (threads.length === 0) return;
  const filtered = new Set((Gmail.Users.Settings.Filters.list('me').filter || [])
    .map(f => ((f.criteria && f.criteria.from) || '').toLowerCase()));
  const senders = new Set(threads.map(senderOf_).filter(a => a && !filtered.has(a)));
  if (senders.size > 0) {
    senders.forEach(from => {
      Gmail.Users.Settings.Filters.create({ criteria: { from }, action: { addLabelIds: [labelId_(LABEL_PRETRASH)], removeLabelIds: ['INBOX', 'IMPORTANT'] } }, 'me');
      console.log('🗑️ Pretrashing future mail from ' + from);
    });
  }
  pretrash_(threads);
}

function deleteOlder() {
  const ids = searchIds_('label:' + LABEL_PRETRASH + ' older_than:' + PRETRASH_AGE_DAYS + 'd');
  if (ids.length === 0) return;
  console.log('🧹 Trashing ' + ids.length + ' expired pretrash threads' + subjects_(ids));
  ids.forEach(id => Gmail.Users.Threads.trash('me', id));
}

function markPinnedAsImportant() {
  const ids = searchIds_('(label:pinned OR label:snoozed) is:unimportant');
  if (ids.length === 0) return;
  console.log('⭐ Promoting ' + ids.length + ' pinned threads' + subjects_(ids));
  modifyThreads_(ids, ['IMPORTANT'], []);
}

function markTrashAsUnimportant() {
  const ids = searchIds_('in:trash is:important');
  if (ids.length === 0) return;
  console.log('📉 Demoting ' + ids.length + ' trashed importants' + subjects_(ids));
  modifyThreads_(ids, [], ['IMPORTANT']);
}

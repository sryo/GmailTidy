/*
Fast pass: labels, archives, ping, stash.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function cleanUp() {
  safely_('markDoneAsRead',            markDoneAsRead);
  safely_('markPinnedAsImportant',     markPinnedAsImportant);
  safely_('blockHandTrashedSenders_',  blockHandTrashedSenders_);
  safely_('salvagePretrashOnSignals_', salvagePretrashOnSignals_);
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
  const threads = GmailApp.search('label:inbox is:read older_than:' + ARCHIVE_INBOX_AGE_DAYS + 'd -label:pinned -label:snoozed -label:"' + LABEL_PING + '" -label:"' + LABEL_AUTOREPLY + '"');
  if (threads.length === 0) return;
  console.log('📦 Archiving ' + threads.length + ' read threads' + subjects_(threads));
  inChunks_(threads, c => GmailApp.moveThreadsToArchive(c));
}

function ping() {
  const pinged = trackingIndex_(TRACKING_TYPE_PINGED);
  const threads = GmailApp.search('is:read older_than:' + PING_PICKUP_DAYS + 'd newer_than:' + PING_EXPIRE_DAYS + 'd -label:sent -is:muted -label:done -label:pinned -label:snoozed -label:"' + LABEL_PING + '" -label:' + LABEL_PRETRASH + ' -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_VOICE + '" -in:trash');
  const candidates = threads.filter(t => t.getMessageCount() === 1 && !pinged[t.getId()]);
  if (candidates.length === 0) return;
  console.log('↩️ Pinging ' + candidates.length + ' forgotten reads' + subjects_(candidates));
  const pingLabel = getOrCreateUserLabel(LABEL_PING);
  inChunks_(candidates, c => pingLabel.addToThreads(c));
  applyPingTo_(candidates);
}

// Your unanswered question comes back as a ping; Riff drafts the follow-up.
function nudge() {
  const pinged = trackingIndex_(TRACKING_TYPE_PINGED);
  const threads = GmailApp.search('label:sent older_than:' + NUDGE_PICKUP_DAYS + 'd newer_than:' + NUDGE_WINDOW_DAYS + 'd -filename:ics -is:muted -label:done -label:pinned -label:snoozed -label:"' + LABEL_PING + '" -label:' + LABEL_PRETRASH + ' -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_VOICE + '" -in:trash');
  const unpinged = threads.filter(t => !pinged[t.getId()]);
  const messagesByThread = GmailApp.getMessagesForThreads(unpinged);
  const candidates = unpinged.filter((t, i) => {
    const last = messagesByThread[i].filter(m => !m.isDraft()).pop();
    return last && isFromMe_(last.getFrom()) && !isFromMe_(last.getTo())
      && businessDaysSince_(last.getDate().getTime(), Date.now()) >= NUDGE_PICKUP_DAYS
      && stripQuotedReplyHistory_(last.getPlainBody() || '').includes('?');
  });
  if (candidates.length === 0) return;
  console.log('↩️ Nudging ' + candidates.length + ' unanswered questions' + subjects_(candidates));
  const pingLabel = getOrCreateUserLabel(LABEL_PING);
  inChunks_(candidates, c => pingLabel.addToThreads(c));
  applyPingTo_(candidates);
}

// Mute is Gmail's "I'm done with this conversation"; treat it as dismissing the ping.
function dismissMutedPings_() {
  const threads = GmailApp.search('is:muted (label:"' + LABEL_PING + '" OR label:"' + LABEL_AUTOREPLY + '")');
  if (threads.length === 0) return;
  console.log('🔇 Dismissing ' + threads.length + ' muted pings' + subjects_(threads));
  removeLabelIfExists_(LABEL_PING, threads);
  removeLabelIfExists_(LABEL_AUTOREPLY, threads);
  inChunks_(threads, c => GmailApp.moveThreadsToArchive(c));
}

function salvagePretrashOnSignals_() {
  // Documented contract: star, important, reply, 🦾, ↩️ all signal KEEP.
  // Strip 🗑️ as soon as any of those appear so deleteOlder doesn't trash a thread the user revived.
  // label:sent (not from:me): from:me false-matches forwarded mail from Send-As aliases.
  const threads = GmailApp.search('label:' + LABEL_PRETRASH + ' (is:starred OR is:important OR label:sent OR label:"' + LABEL_AUTOREPLY + '" OR label:"' + LABEL_PING + '")');
  if (threads.length === 0) return;
  console.log('🗑️ Salvaging ' + threads.length + ' pretrashed threads with KEEP signals' + subjects_(threads));
  removeLabelIfExists_(LABEL_PRETRASH, threads);
}

function syncManualPings_() {
  // Detects threads the user labeled ↩️ themselves and treats them like an auto-ping.
  // A manual ↩️ on a 🗑️ thread is a salvage; salvagePretrashOnSignals_ strips 🗑️ earlier in the same pass.
  const pinged = trackingIndex_(TRACKING_TYPE_PINGED);
  const threads = GmailApp.search('label:"' + LABEL_PING + '" -in:trash');
  const untracked = threads.filter(t => !pinged[t.getId()]);
  if (untracked.length === 0) return;
  console.log('↩️ Syncing ' + untracked.length + ' manually pinged threads' + subjects_(untracked));
  applyPingTo_(untracked);
}

// Every ping, auto or manual, gets a Riff draft and returns to the inbox.
function applyPingTo_(threads) {
  if (!threads || threads.length === 0) return;
  const autoreply = getOrCreateUserLabel(LABEL_AUTOREPLY);
  inChunks_(threads, c => autoreply.addToThreads(c));
  inChunks_(threads, c => GmailApp.moveThreadsToInbox(c));
  safely_('ping track', () => recordTrackingRows(threads.map(t => t.getId()), TRACKING_TYPE_PINGED));
}

function archiveDismissedPings_() {
  // Dismissal: the user removes ↩️; its absence on a tracked thread is the gesture. A reply that
  // arrived after the ping is new mail, not a dismissal, so that thread stays.
  const pingedAt = trackingTimes_(TRACKING_TYPE_PINGED);
  if (Object.keys(pingedAt).length === 0) return;
  const toArchive = GmailApp.search('in:inbox -label:"' + LABEL_PING + '"')
    .filter(t => pingedAt[t.getId()] && !hasIncomingSince_(t, pingedAt[t.getId()]));
  if (toArchive.length === 0) return;
  console.log('📦 Archiving ' + toArchive.length + ' dismissed pings' + subjects_(toArchive));
  removeLabelIfExists_(LABEL_AUTOREPLY, toArchive);
  inChunks_(toArchive, c => GmailApp.moveThreadsToArchive(c));
}

function archiveStalePings_() {
  // Passive dismissal: ↩️ still on PING_EXPIRE_DAYS after the ping. Aged by the ping row, not by
  // message dates, so a manual ↩️ on an old thread gets its full window.
  const pingedAt = trackingTimes_(TRACKING_TYPE_PINGED);
  const cutoff = Date.now() - PING_EXPIRE_DAYS * MS_PER_DAY;
  const threads = GmailApp.search('label:"' + LABEL_PING + '" -in:trash').filter(t => pingedAt[t.getId()] < cutoff);
  if (threads.length === 0) return;
  console.log('📦 Archiving ' + threads.length + ' stale pings' + subjects_(threads));
  removeLabelIfExists_(LABEL_PING, threads);
  removeLabelIfExists_(LABEL_AUTOREPLY, threads);
  inChunks_(threads, c => GmailApp.moveThreadsToArchive(c));
}

function stash() {
  // Bucketed at MAX_THREADS_TAG per run; bigger backlogs catch up over subsequent cleanUp cycles.
  const threads = GmailApp.search('is:important has:attachment -label:"' + LABEL_STASH + '" -label:' + LABEL_PRETRASH + ' -in:trash', 0, MAX_THREADS_TAG);
  if (threads.length === 0) return;
  console.log('🪎 Stashing ' + threads.length + ' important attachments' + subjects_(threads));
  getOrCreateUserLabel(LABEL_STASH).addToThreads(threads);
}

function markDoneAsRead() {
  const threads = GmailApp.search('label:done is:unread -label:pinned -label:snoozed');
  if (threads.length === 0) return;
  console.log('📖 Marking ' + threads.length + ' done threads as read' + subjects_(threads));
  inChunks_(threads, c => GmailApp.markThreadsRead(c));
}

function preTrashLowPriority() {
  // A previously pretrashed thread that lost 🗑️ without a KEEP signal was salvaged by hand:
  // remember it so it's never pretrashed again.
  const pretrashedAt = trackingTimes_(TRACKING_TYPE_PRETRASHED);
  const salvaged = trackingTimes_(TRACKING_TYPE_SALVAGED);
  // Inbox only: GmailApp.search returns at most 500 threads, so a mailbox-wide scan misses older ones.
  const query = 'in:inbox -label:' + LABEL_PRETRASH + ' -is:important -label:pinned -label:snoozed -label:done -is:starred -label:sent -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_PING + '" -label:"' + LABEL_VOICE + '"';
  const candidates = GmailApp.search(query).filter(t => !salvaged[t.getId()]);
  // Gmail sometimes marks real people unimportant; anyone you've written to stays,
  // remembered as salvaged so the thread isn't re-read every run.
  const fresh = candidates.filter(t => !pretrashedAt[t.getId()]);
  const kept = fresh.filter(t => hasWrittenTo_(senderOf_(t)));
  const newlySalvaged = candidates.filter(t => pretrashedAt[t.getId()]).concat(kept);
  const threads = fresh.filter(t => !kept.includes(t));

  if (newlySalvaged.length > 0) {
    console.log('🗑️ Remembering ' + newlySalvaged.length + ' salvaged threads' + subjects_(newlySalvaged));
    recordTrackingRows(newlySalvaged.map(t => t.getId()), TRACKING_TYPE_SALVAGED);
  }
  if (threads.length === 0) return;
  console.log('🗑️ Pretrashing ' + threads.length + ' low-priority threads' + subjects_(threads));
  pretrash_(threads);
}

// Unimportant so salvagePretrashOnSignals_ doesn't read Gmail's flag as a KEEP signal.
function pretrash_(threads) {
  const pretrash = getOrCreateUserLabel(LABEL_PRETRASH);
  inChunks_(threads, c => pretrash.addToThreads(c));
  inChunks_(threads, c => GmailApp.moveThreadsToArchive(c));
  inChunks_(threads, c => GmailApp.markThreadsUnimportant(c));
  stripAllLabelsExcept(threads, [LABEL_PRETRASH]);
  recordTrackingRows(threads.map(t => t.getId()), TRACKING_TYPE_PRETRASHED);
}

// Recurring automated mail (same sender, same subject once digits are masked): only the newest stays.
// Attachments are exempt so statements and invoices are never collapsed.
function keepNewest_() {
  const salvaged = trackingTimes_(TRACKING_TYPE_SALVAGED);
  const threads = GmailApp.search('category:updates -has:attachment -label:' + LABEL_PRETRASH + ' -is:starred -label:pinned -label:snoozed -label:sent -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_PING + '" -label:"' + LABEL_VOICE + '" -label:"' + LABEL_PUBLIC + '" -in:trash', 0, KEEP_NEWEST_SCAN_LIMIT);
  if (threads.length === 0) return;
  const seen = new Set();
  const older = [];
  GmailApp.getMessagesForThreads(threads).forEach((msgs, i) => {
    const key = extractAddress_(msgs[0].getFrom()) + '|' + recurringSubjectKey_(msgs[0].getSubject());
    if (seen.has(key)) {
      if (!salvaged[threads[i].getId()]) older.push(threads[i]);
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

// Applying 🗑️ by hand blocks the sender: a Gmail filter (visible in Settings > Filters) sends their
// future mail to 🗑️. Any 🗑️ thread without a pretrashed row got it by hand or from such a filter.
function blockHandTrashedSenders_() {
  const pretrashedAt = trackingTimes_(TRACKING_TYPE_PRETRASHED);
  const threads = GmailApp.search('label:' + LABEL_PRETRASH + ' -in:trash').filter(t => !pretrashedAt[t.getId()]);
  if (threads.length === 0) return;
  const filtered = new Set((Gmail.Users.Settings.Filters.list('me').filter || [])
    .map(f => ((f.criteria && f.criteria.from) || '').toLowerCase()));
  const senders = new Set(threads.map(senderOf_).filter(a => a && !filtered.has(a)));
  if (senders.size > 0) {
    const labelId = Gmail.Users.Labels.list('me').labels.find(l => l.name === LABEL_PRETRASH).id;
    senders.forEach(from => {
      Gmail.Users.Settings.Filters.create({ criteria: { from }, action: { addLabelIds: [labelId], removeLabelIds: ['INBOX', 'IMPORTANT'] } }, 'me');
      console.log('🚫 Blocking ' + from);
    });
  }
  pretrash_(threads);
}

function deleteOlder() {
  const threads = GmailApp.search('label:' + LABEL_PRETRASH + ' older_than:' + PRETRASH_AGE_DAYS + 'd');
  if (threads.length === 0) return;
  console.log('🧹 Trashing ' + threads.length + ' expired pretrash threads' + subjects_(threads));
  inChunks_(threads, c => GmailApp.moveThreadsToTrash(c));
}

function markPinnedAsImportant() {
  const threads = GmailApp.search('(label:pinned OR label:snoozed) is:unimportant');
  if (threads.length === 0) return;
  console.log('⭐ Promoting ' + threads.length + ' pinned threads' + subjects_(threads));
  inChunks_(threads, c => GmailApp.markThreadsImportant(c));
}

function markTrashAsUnimportant() {
  const threads = GmailApp.search('in:trash is:important');
  if (threads.length === 0) return;
  console.log('📉 Demoting ' + threads.length + ' trashed importants' + subjects_(threads));
  inChunks_(threads, c => GmailApp.markThreadsUnimportant(c));
}

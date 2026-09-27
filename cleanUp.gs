/*
Fast pass: labels, archives, ping, stash.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function cleanUp() {
  safely_('markDoneAsRead',            markDoneAsRead);
  safely_('markPinnedAsImportant',     markPinnedAsImportant);
  safely_('salvagePretrashOnSignals_', salvagePretrashOnSignals_);
  safely_('deleteOlder',               deleteOlder);
  safely_('preTrashLowPriority',       preTrashLowPriority);
  safely_('markTrashAsUnimportant',    markTrashAsUnimportant);
  safely_('archiveDismissedPings_',    archiveDismissedPings_);
  safely_('archiveStalePings_',        archiveStalePings_);
  safely_('ping',                      ping);
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
  const threads = GmailApp.search('is:read older_than:' + PING_PICKUP_DAYS + 'd newer_than:' + PING_EXPIRE_DAYS + 'd -label:sent -label:done -label:pinned -label:snoozed -label:"' + LABEL_PING + '" -label:' + LABEL_PRETRASH + ' -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_STASH + '" -label:"' + LABEL_VOICE + '" -in:trash');
  const candidates = threads.filter(t => t.getMessageCount() === 1 && !pinged[t.getId()]);
  if (candidates.length === 0) return;
  console.log('↩️ Pinging ' + candidates.length + ' forgotten reads' + subjects_(candidates));
  const pingLabel = getOrCreateUserLabel(LABEL_PING);
  inChunks_(candidates, c => pingLabel.addToThreads(c));
  applyPingTo_(candidates);
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
  const query = '-label:' + LABEL_PRETRASH + ' ' + PRETRASH_CATEGORY_QUERY + ' -is:important -label:pinned -label:snoozed -label:done -is:starred -label:sent -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_PING + '" -label:"' + LABEL_VOICE + '"';
  const candidates = GmailApp.search(query).filter(t => !salvaged[t.getId()]);
  const newlySalvaged = candidates.filter(t => pretrashedAt[t.getId()]);
  const threads = candidates.filter(t => !pretrashedAt[t.getId()]);

  if (newlySalvaged.length > 0) {
    console.log('🗑️ Remembering ' + newlySalvaged.length + ' salvaged threads' + subjects_(newlySalvaged));
    recordTrackingRows(newlySalvaged.map(t => t.getId()), TRACKING_TYPE_SALVAGED);
  }
  if (threads.length === 0) return;
  console.log('🗑️ Pretrashing ' + threads.length + ' low-priority threads' + subjects_(threads));

  const pretrash = getOrCreateUserLabel(LABEL_PRETRASH);
  inChunks_(threads, c => pretrash.addToThreads(c));
  inChunks_(threads, c => GmailApp.moveThreadsToArchive(c));
  stripAllLabelsExcept(threads, [LABEL_PRETRASH]);
  recordTrackingRows(threads.map(t => t.getId()), TRACKING_TYPE_PRETRASHED);
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

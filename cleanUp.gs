/*
Fast pass: labels, archives, ping, stash.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function cleanUp() {
  markDoneAsRead();
  markPinnedAsImportant();
  salvagePretrashOnSignals_();
  deleteOlder();
  preTrashLowPriority();
  markTrashAsUnimportant();
  archiveDismissedPings_();
  archiveStalePings_();
  ping();
  syncManualPings_();
  stash();
  archiveInbox();
}

function archiveInbox() {
  const threads = GmailApp.search('label:inbox is:read older_than:' + ARCHIVE_INBOX_AGE_DAYS + 'd -label:pinned -label:snoozed -label:"' + LABEL_PING + '" -label:"' + LABEL_AUTOREPLY + '"');
  if (threads.length === 0) return;
  Logger.log('📦 Archiving ' + threads.length + ' read threads.');
  GmailApp.moveThreadsToArchive(threads);
}

function ping() {
  const pinged = trackingIndex_(TRACKING_TYPE_PINGED);
  const threads = GmailApp.search('is:read older_than:' + PING_PICKUP_DAYS + 'd newer_than:' + PING_EXPIRE_DAYS + 'd -label:sent -label:done -label:pinned -label:snoozed -label:"' + LABEL_PING + '" -label:' + LABEL_PRETRASH + ' -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_STASH + '" -label:"' + LABEL_VOICE + '" -in:trash');
  const candidates = threads.filter(t => t.getMessageCount() === 1 && !pinged[t.getId()]);
  if (candidates.length === 0) return;
  Logger.log(LABEL_PING + ' Pinging ' + candidates.length + ' forgotten reads.');
  getOrCreateUserLabel(LABEL_PING).addToThreads(candidates);
  applyPingTo_(candidates);
}

function salvagePretrashOnSignals_() {
  // Documented contract: star, important, reply, 🦾, ↩️ all signal KEEP.
  // Strip 🗑️ as soon as any of those appear so deleteOlder doesn't trash a thread the user revived.
  // label:sent (not from:me): from:me false-matches forwarded mail from Send-As aliases.
  const threads = GmailApp.search('label:' + LABEL_PRETRASH + ' (is:starred OR is:important OR label:sent OR label:"' + LABEL_AUTOREPLY + '" OR label:"' + LABEL_PING + '")');
  if (threads.length === 0) return;
  Logger.log(LABEL_PRETRASH + ' Salvaging ' + threads.length + ' pretrashed threads with KEEP signals.');
  threads.forEach(t => {
    const reasons = [];
    const labels = t.getLabels().map(l => l.getName());
    if (labels.indexOf(LABEL_AUTOREPLY) >= 0) reasons.push('🦾');
    if (labels.indexOf(LABEL_PING) >= 0) reasons.push('↩️');
    if (t.isImportant()) reasons.push('important');
    if (t.getMessages().some(m => m.isStarred())) reasons.push('starred');
    if (reasons.length === 0) reasons.push('replied');
    Logger.log('  • [' + reasons.join(',') + '] ' + t.getFirstMessageSubject());
  });
  removeLabelIfExists_(LABEL_PRETRASH, threads);
}

function syncManualPings_() {
  // Detects threads the user labeled ↩️ themselves and treats them like an auto-ping.
  // A manual ↩️ on a 🗑️ thread is a salvage; salvagePretrashOnSignals_ strips 🗑️ earlier in the same pass.
  const pinged = trackingIndex_(TRACKING_TYPE_PINGED);
  const threads = GmailApp.search('label:"' + LABEL_PING + '" -in:trash');
  const untracked = threads.filter(t => !pinged[t.getId()]);
  if (untracked.length === 0) return;
  Logger.log(LABEL_PING + ' Syncing ' + untracked.length + ' manually pinged threads.');
  applyPingTo_(untracked);
}

// Every ping, auto or manual, gets a Riff draft and returns to the inbox.
function applyPingTo_(threads) {
  if (!threads || threads.length === 0) return;
  getOrCreateUserLabel(LABEL_AUTOREPLY).addToThreads(threads);
  GmailApp.moveThreadsToInbox(threads);
  safely_('ping track', () => recordTrackingRows(threads.map(t => t.getId()), TRACKING_TYPE_PINGED));
}

function archiveDismissedPings_() {
  // Dismissal contract: the user removes the ↩️ label to dismiss a ping. We never strip the label
  // ourselves; its absence is the gesture. Tracking row stays after dismissal as a permanent
  // "already pinged" marker so ping() won't resurface the same thread twice. Iterate the bounded
  // inbox search (Gmail caps at 500), not the ever-growing tracked-ID map.
  const pinged = trackingIndex_(TRACKING_TYPE_PINGED);
  if (Object.keys(pinged).length === 0) return;
  const inboxThreads = GmailApp.search('in:inbox -label:"' + LABEL_PING + '"');
  const toArchive = inboxThreads.filter(t => pinged[t.getId()] && !t.isInTrash());
  if (toArchive.length === 0) return;
  Logger.log('📦 Archiving ' + toArchive.length + ' dismissed pings.');
  removeLabelIfExists_(LABEL_AUTOREPLY, toArchive);
  GmailApp.moveThreadsToArchive(toArchive);
}

function archiveStalePings_() {
  // Passive dismissal: a pinged thread that aged past PING_EXPIRE_DAYS without you acting.
  // Remove ping and riff labels so the thread is fully reset.
  const threads = GmailApp.search('label:"' + LABEL_PING + '" in:inbox older_than:' + PING_EXPIRE_DAYS + 'd');
  if (threads.length === 0) return;
  Logger.log('📦 Archiving ' + threads.length + ' stale pings.');
  removeLabelIfExists_(LABEL_PING, threads);
  removeLabelIfExists_(LABEL_AUTOREPLY, threads);
  GmailApp.moveThreadsToArchive(threads);
}

function stash() {
  // Bucketed at MAX_THREADS_TAG per run; bigger backlogs catch up over subsequent cleanUp cycles.
  const threads = GmailApp.search('is:important has:attachment -label:"' + LABEL_STASH + '" -label:' + LABEL_PRETRASH + ' -in:trash', 0, MAX_THREADS_TAG);
  if (threads.length === 0) return;
  Logger.log(LABEL_STASH + ' Stashing ' + threads.length + ' important attachments.');
  getOrCreateUserLabel(LABEL_STASH).addToThreads(threads);
}

function markDoneAsRead() {
  const threads = GmailApp.search('label:done is:unread -label:pinned -label:snoozed');
  if (threads.length === 0) return;
  Logger.log('📖 Marking ' + threads.length + ' done threads as read.');
  GmailApp.markThreadsRead(threads);
}

function preTrashLowPriority() {
  const threads = GmailApp.search('-label:' + LABEL_PRETRASH + ' ' + PRETRASH_CATEGORY_QUERY + ' -is:important -label:pinned -label:snoozed -label:done -is:starred -label:sent -label:"' + LABEL_AUTOREPLY + '" -label:"' + LABEL_PING + '" -label:"' + LABEL_VOICE + '"');
  if (threads.length === 0) return;
  Logger.log(LABEL_PRETRASH + ' Pretrashing ' + threads.length + ' low-priority threads.');

  getOrCreateUserLabel(LABEL_PRETRASH).addToThreads(threads);
  GmailApp.moveThreadsToArchive(threads);
  stripAllLabelsExcept(threads, [LABEL_PRETRASH]);
}

function deleteOlder() {
  const threads = GmailApp.search('label:' + LABEL_PRETRASH + ' older_than:' + PRETRASH_AGE_DAYS + 'd');
  if (threads.length === 0) return;
  Logger.log('🧹 Trashing ' + threads.length + ' expired pretrash threads.');
  GmailApp.moveThreadsToTrash(threads);
}

function markPinnedAsImportant() {
  const threads = GmailApp.search('(label:pinned OR label:snoozed) is:unimportant');
  if (threads.length === 0) return;
  Logger.log('⭐ Promoting ' + threads.length + ' pinned threads.');
  GmailApp.markThreadsImportant(threads);
}

function markTrashAsUnimportant() {
  const threads = GmailApp.search('in:trash is:important');
  if (threads.length === 0) return;
  Logger.log('📉 Demoting ' + threads.length + ' trashed importants.');
  GmailApp.markThreadsUnimportant(threads);
}

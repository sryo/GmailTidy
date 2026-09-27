/*
Apply 🦾 to add some AI muscle: Riff drafts a reply in your voice.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function riff() {
  const trackingValues = getTrackingValues_();
  const drafted = trackingIndex_(TRACKING_TYPE_DRAFTED);
  // Scan wider than the LLM budget: threads parked on a pending draft must not starve the rest.
  const threads = GmailApp.search('label:"' + LABEL_AUTOREPLY + '" -in:trash', 0, RIFF_SCAN_LIMIT);
  if (threads.length === 0) return;

  const autoreply = GmailApp.getUserLabelByName(LABEL_AUTOREPLY);
  const draftedThreadIds = buildDraftThreadIdSet_();
  const rowsToDelete = {};
  let voiceExamples = null;
  let generated = 0;

  threads.forEach(t => {
    try {
      const threadId = t.getId();
      const wasDrafted = !!drafted[threadId];
      const hasDraft = draftedThreadIds.has(threadId);

      // Tracked and the draft is gone: sent (remove 🦾) or discarded (keep 🦾, will redraft).
      if (wasDrafted && !hasDraft) {
        const draftedAt = trackingValues[drafted[threadId] - 1][2];
        rowsToDelete[drafted[threadId]] = true;
        if (wasReplySentAfter_(t, draftedAt)) {
          autoreply.removeFromThreads([t]);
          Logger.log('🦾 Riff sent for ' + threadId + '.');
        } else {
          Logger.log('🦾 Riff discarded on ' + threadId + ', will redraft.');
        }
        return;
      }

      // Has a draft already (ours or the user's). Track if we hadn't, then leave alone.
      if (hasDraft) {
        if (!wasDrafted) recordTrackingRows([threadId], TRACKING_TYPE_DRAFTED);
        return;
      }

      // No draft yet: generate one, within the per-run LLM budget.
      if (generated >= AUTOREPLY_BATCH_LIMIT) return;
      generated++;
      if (!voiceExamples) voiceExamples = loadVoiceExamples_();
      const result = generateReplyDraft(t, voiceExamples);
      if (!result) return; // abstain on API failure, retry next tick
      if (!result.draft) {
        Logger.log('🦾 Riff skipped ' + threadId + ' (' + (result.notes || 'no draft returned') + ').');
        autoreply.removeFromThreads([t]);
        return;
      }

      if (AUTOREPLY_DRY_RUN) {
        Logger.log('🦾 [DRY RUN] would draft for ' + threadId + ':\n' + result.draft);
      } else {
        const { body, htmlBody } = buildReplyBody_(t, result.draft);
        t.createDraftReply(body, { htmlBody });
        t.moveToInbox();
        t.markUnread();
      }
      recordTrackingRows([threadId], TRACKING_TYPE_DRAFTED);
      Logger.log('🦾 Riffing reply for ' + threadId + '.');
    } catch (e) {
      console.log('riff ' + t.getId() + ': ' + e.toString());
    }
  });

  deleteTrackingRows_(Object.keys(rowsToDelete).map(Number));
}


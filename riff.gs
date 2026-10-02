/*
Apply 🦾 to add some AI muscle: Riff drafts a reply in your voice.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function riff() {
  const trackingValues = getTrackingValues_();
  const drafted = trackingIndex_(TRACKING_TYPE_DRAFTED);
  // Scan wider than the LLM budget: threads parked on a pending draft must not starve the rest.
  const ids = searchIds_('label:"' + LABEL_AUTOREPLY + '" -in:trash', RIFF_SCAN_LIMIT);
  if (ids.length === 0) return;

  const autoreply = labelId_(LABEL_AUTOREPLY);
  const draftedThreadIds = buildDraftThreadIdSet_();
  const rowsToDelete = {};
  let voiceExamples = null;
  let generated = 0;

  // GmailApp only once a draft is actually written: its daily quota is too small to spend on scanning.
  ids.forEach(threadId => {
    try {
      const wasDrafted = !!drafted[threadId];
      const hasDraft = draftedThreadIds.has(threadId);

      // Tracked and the draft is gone: sent (remove 🦾) or discarded (redraft differently below).
      const redraft = wasDrafted && !hasDraft;
      if (redraft && wasReplySentAfter_(getThread_(threadId), trackingValues[drafted[threadId] - 1][2])) {
        rowsToDelete[drafted[threadId]] = true;
        modifyThreads_([threadId], [], [autoreply]);
        console.log('🦾 Riff sent' + subjects_([threadId]));
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
      const t = GmailApp.getThreadById(threadId);
      const result = generateReplyDraft(t, voiceExamples, redraft);
      if (!result) return; // abstain on API failure, retry next tick
      if (redraft) rowsToDelete[drafted[threadId]] = true;
      if (!result.draft) {
        console.log('🦾 Riff skipped (' + (result.notes || 'no draft returned') + ')' + subjects_([t]));
        modifyThreads_([threadId], [], [autoreply]);
        return;
      }

      if (AUTOREPLY_DRY_RUN) {
        console.log('🦾 [DRY RUN] would draft' + subjects_([t]) + '\n' + result.draft);
      } else {
        const { body, htmlBody } = buildReplyBody_(t, result.draft);
        t.createDraftReply(body, { htmlBody });
        t.moveToInbox();
        t.markUnread();
      }
      recordTrackingRows([threadId], TRACKING_TYPE_DRAFTED);
      console.log('🦾 ' + (redraft ? 'Riff discarded, redrafting' : 'Riffing reply') + subjects_([t]));
    } catch (e) {
      console.error('🦾 Riff failed on ' + threadId + ': ' + e.toString());
    }
  });

  deleteTrackingRows_(Object.keys(rowsToDelete).map(Number));
}


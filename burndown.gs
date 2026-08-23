/*
Reply to one daily digest to draft your whole morning's replies.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function sendBurndown() {
  const threads = GmailApp.search(BURNDOWN_QUERY, 0, BURNDOWN_LIMIT);
  if (threads.length === 0) {
    Logger.log('🔥 Burndown: nothing to triage.');
    return;
  }
  const userEmail = Gmail.Users.getProfile('me').emailAddress;
  const draftMap = buildDraftMapForThreads_();
  const items = threads.map(t => buildBurndownItem_(t, draftMap, userEmail));
  const summaries = generateBurndownSummaries_(items);
  items.forEach(i => { i.summary = summaries[i.threadId] || ''; });
  const subject = BURNDOWN_SUBJECT_PREFIX + ' ' + formatBurndownDate_();
  const { plainBody, htmlBody } = composeBurndownBody_(items);
  GmailApp.sendEmail(userEmail, subject, plainBody, { htmlBody, name: BURNDOWN_SUBJECT_PREFIX });
  Logger.log('🔥 Burndown sent ' + items.length + ' threads to ' + userEmail + '.');
}

function buildBurndownItem_(thread, draftMap, userEmail) {
  const lower = userEmail.toLowerCase();
  const messages = thread.getMessages();
  const latest = messages.slice().reverse().find(m => !m.getFrom().toLowerCase().includes(lower))
              || messages[messages.length - 1];
  const draft = draftMap.get(thread.getId());
  const riffBody = draft
    ? stripQuotedReplyHistory_(draft.getMessage().getPlainBody() || '').trim()
    : '';
  return {
    threadId: thread.getId(),
    sender: latest.getFrom(),
    subject: thread.getFirstMessageSubject() || '(no subject)',
    snippet: (latest.getPlainBody() || '').replace(/\s+/g, ' ').trim().substring(0, BURNDOWN_SNIPPET_CAP),
    riffDraft: riffBody
  };
}

function generateBurndownSummaries_(items) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(PROPS.GEMINI_API_KEY);
  if (!apiKey) {
    console.log('burndown-summarizer: GEMINI_API_KEY not set, skipping summaries.');
    return {};
  }
  const itemsBlock = items
    .map(i => `id: ${i.threadId} | From: ${i.sender} | Subject: ${i.subject} | ${i.snippet}`)
    .join('\n');
  const result = callGemini_(BURNDOWN_SUMMARY_PROMPT(itemsBlock), apiKey, { logPrefix: 'burndown-summarizer' });
  if (!result || !Array.isArray(result.summaries)) return {};
  const map = {};
  result.summaries.forEach(s => { if (s && s.id) map[s.id] = (s.summary || '').trim(); });
  return map;
}

function composeBurndownBody_(items) {
  const intro = items.length + ' threads waiting. Reply to this email, expand quoted content, and edit the right-column cells. Leave a Riff suggestion alone to accept it; clear a cell to skip.';
  const plainBody = intro + '\n\n' + items.map(composeBurndownPlainRow_).join('\n\n');
  const htmlBody = composeBurndownHtml_(intro, items);
  return { plainBody, htmlBody };
}

function composeBurndownPlainRow_(item) {
  return [
    BURNDOWN_MARKER_PREFIX + item.threadId,
    'From: ' + item.sender,
    'Subject: ' + item.subject,
    'Summary: ' + (item.summary || item.snippet),
    BURNDOWN_REPLY_PROMPT,
    item.riffDraft || ''
  ].join('\n');
}

function composeBurndownHtml_(intro, items) {
  const rows = items.map(i => `<tr>
  <td style="vertical-align:top;padding:12px;border-bottom:1px solid #eee;width:50%;">
    <div style="font-size:11px;color:#999;font-family:monospace;">${escapeHtml(BURNDOWN_MARKER_PREFIX + i.threadId)}</div>
    <div style="font-size:12px;color:#555;margin-top:4px;">${escapeHtml(i.sender)}</div>
    <div style="font-weight:600;margin-top:2px;">${escapeHtml(i.subject)}</div>
    <div style="font-size:13px;color:#333;margin-top:6px;">${escapeHtml(i.summary || i.snippet)}</div>
  </td>
  <td style="vertical-align:top;padding:12px;border-bottom:1px solid #eee;width:50%;">
    <div style="font-size:12px;color:#999;">${escapeHtml(BURNDOWN_REPLY_PROMPT)}</div>
    <div style="white-space:pre-wrap;font-family:sans-serif;margin-top:6px;">${escapeHtml(i.riffDraft)}</div>
  </td>
</tr>`).join('\n');
  return `<div style="font-family:sans-serif;">
  <p style="margin:0 0 12px 0;">${escapeHtml(intro)}</p>
  <table style="border-collapse:collapse;width:100%;max-width:760px;">
    <thead><tr>
      <th style="text-align:left;padding:8px;border-bottom:2px solid #333;width:50%;">${escapeHtml(BURNDOWN_TABLE_HEADER_LEFT)}</th>
      <th style="text-align:left;padding:8px;border-bottom:2px solid #333;width:50%;">${escapeHtml(BURNDOWN_TABLE_HEADER_RIGHT)}</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
</div>`;
}

function formatBurndownDate_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ===== Parser / actor =====

function processBurndownReplies_() {
  // Tracking row uses message ID as the key (despite the schema's "threadId" column name) because
  // the same digest thread can carry multiple distinct reply messages, each acting on a different
  // set of threads. Renaming the column to be polymorphic would ripple through three other features.
  const processed = trackingIndex_(TRACKING_TYPE_BURNDOWN_PROCESSED);
  const userEmail = Gmail.Users.getProfile('me').emailAddress;
  const lower = userEmail.toLowerCase();

  const digestThreads = GmailApp.search('subject:"' + BURNDOWN_SUBJECT_PREFIX + '" label:sent -in:trash newer_than:' + BURNDOWN_PROCESSED_TTL_DAYS + 'd');
  if (digestThreads.length === 0) return;

  const actedMsgIds = [];

  digestThreads.forEach(thread => {
    const messages = thread.getMessages();
    if (messages.length < 2) return;
    const digestDate = messages[0].getDate();
    for (let i = 1; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg.getFrom().toLowerCase().includes(lower)) continue;
      const msgId = msg.getId();
      if (processed[msgId]) continue;
      try {
        const entries = parseBurndownReply_(msg.getBody(), msg.getPlainBody());
        actOnBurndownEntries_(entries, digestDate, userEmail);
        actedMsgIds.push(msgId);
      } catch (e) {
        console.log('Burndown parse failed for ' + msgId + ': ' + e.toString());
      }
    }
  });

  if (actedMsgIds.length > 0) {
    recordTrackingRows(actedMsgIds, TRACKING_TYPE_BURNDOWN_PROCESSED);
    Logger.log('🔥 Burndown processed ' + actedMsgIds.length + ' reply message(s).');
  }
}

function parseBurndownReply_(htmlBody, plainBody) {
  const fromHtml = parseBurndownHtml_(htmlBody);
  if (fromHtml.length > 0) return fromHtml;
  return parseBurndownPlain_(plainBody);
}

function parseBurndownHtml_(html) {
  if (!html) return [];
  const entries = [];
  const rowMatches = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  const markerRe = new RegExp(escapeRegExp_(BURNDOWN_MARKER_PREFIX) + '([A-Za-z0-9_-]+)');
  rowMatches.forEach(rowHtml => {
    const cells = rowHtml.match(/<td[\s\S]*?<\/td>/gi);
    if (!cells || cells.length < 2) return;
    const leftText = htmlCellText_(cells[0]);
    const markerMatch = leftText.match(markerRe);
    if (!markerMatch) return;
    const rightText = htmlCellText_(cells[1]);
    entries.push({ threadId: markerMatch[1], replyText: stripReplyPromptPrefix_(rightText) });
  });
  return entries;
}

function htmlCellText_(cellHtml) {
  return cellHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}

function stripReplyPromptPrefix_(text) {
  const pattern = new RegExp('^\\s*' + escapeRegExp_(BURNDOWN_REPLY_PROMPT) + '\\s*', 'i');
  return text.replace(pattern, '').trim();
}

function escapeRegExp_(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseBurndownPlain_(text) {
  if (!text) return [];
  const lines = text.split('\n').map(l => l.replace(/^>+\s?/g, ''));
  const markerRe = new RegExp('^\\s*' + escapeRegExp_(BURNDOWN_MARKER_PREFIX) + '([A-Za-z0-9_-]+)');
  const sections = [];
  let current = null;
  lines.forEach(line => {
    const m = line.match(markerRe);
    if (m) {
      if (current) sections.push(current);
      current = { threadId: m[1], lines: [] };
      return;
    }
    if (current) current.lines.push(line);
  });
  if (current) sections.push(current);

  const promptRe = new RegExp('^\\s*' + escapeRegExp_(BURNDOWN_REPLY_PROMPT) + '\\s*', 'i');
  return sections.map(s => {
    const cleaned = s.lines
      .filter(l => !/^\s*(From:|Subject:|Summary:)/i.test(l))
      .map(l => l.replace(promptRe, ''))
      .join('\n')
      .trim();
    return { threadId: s.threadId, replyText: cleaned };
  });
}

function actOnBurndownEntries_(entries, digestSentDate, userEmail) {
  if (entries.length === 0) return;
  const draftMap = buildDraftMapForThreads_();
  entries.forEach(entry => {
    const text = (entry.replyText || '').trim();
    if (!text) return;
    let thread;
    try { thread = GmailApp.getThreadById(entry.threadId); }
    catch (e) { console.log('🔥 Burndown: thread ' + entry.threadId + ' unreachable.'); return; }
    if (!thread || thread.isInTrash()) return;
    if (wasReplySentAfter_(thread, userEmail, digestSentDate)) {
      Logger.log('🔥 Burndown skipping ' + entry.threadId + ': user already replied.');
      return;
    }
    sendOrDraftBurndownReply_(thread, text, draftMap.get(entry.threadId), userEmail);
  });
}

function sendOrDraftBurndownReply_(thread, text, existingDraft, userEmail) {
  const { body, htmlBody } = buildReplyBody_(thread, text, userEmail);
  if (existingDraft) {
    const draftMsg = existingDraft.getMessage();
    existingDraft.update(draftMsg.getTo(), draftMsg.getSubject(), body, {
      htmlBody,
      cc: draftMsg.getCc(),
      bcc: draftMsg.getBcc()
    });
    if (BURNDOWN_AUTOSEND) {
      existingDraft.send();
      Logger.log('🔥 Burndown sent reply to ' + thread.getId() + '.');
    } else {
      Logger.log('🔥 Burndown updated draft for ' + thread.getId() + '.');
    }
    return;
  }
  if (BURNDOWN_AUTOSEND) {
    thread.reply(body, { htmlBody });
    Logger.log('🔥 Burndown sent reply to ' + thread.getId() + '.');
  } else {
    thread.createDraftReply(body, { htmlBody });
    Logger.log('🔥 Burndown drafted reply for ' + thread.getId() + '.');
  }
}

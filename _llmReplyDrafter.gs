/*
Drafts a reply that mimics your 🫵-labeled sent emails.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

// redraft: the previous draft was discarded, so push for a different one.
function generateReplyDraft(thread, voiceExamples, redraft) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(PROPS.GEMINI_API_KEY);
  if (!apiKey) {
    console.warn('🦾 Riff: GEMINI_API_KEY not set, abstaining');
    return null;
  }
  const ctx = buildReplyContext_(thread, voiceExamples, redraft);
  const result = callGemini_(buildReplyPrompt_(ctx), apiKey, {
    temperature: redraft ? DRAFTER_REDRAFT_TEMPERATURE : DRAFTER_TEMPERATURE,
    schema: REPLY_RESPONSE_SCHEMA,
    logPrefix: 'drafter'
  });
  if (!result) return null;
  return { draft: result.draft || '', notes: result.notes || '' };
}

function buildReplyContext_(thread, voiceExamples, redraft) {
  const subject = thread.getFirstMessageSubject() || '';
  const all = thread.getMessages();
  const messages = all.slice(-REPLY_THREAD_MESSAGE_WINDOW).map(m => ({
    from: m.getFrom(),
    to: m.getTo(),
    cc: m.getCc(),
    date: m.getDate().toISOString(),
    body: stripQuotedReplyHistory_(m.getPlainBody() || '').substring(0, REPLY_MESSAGE_BODY_CAP)
  }));
  const incoming = all.slice().reverse().find(m => !isFromMe_(m.getFrom()));
  const priorReplies = incoming ? loadPriorReplies_(extractAddress_(incoming.getFrom()), thread.getId()) : [];
  return { userEmail: userEmail_(), subject, messages, voiceExamples: voiceExamples || [], priorReplies, redraft: !!redraft };
}

function loadPriorReplies_(address, excludeThreadId) {
  if (!address) return [];
  const threads = GmailApp.search('label:sent to:' + address + ' -in:trash', 0, PRIOR_REPLIES_MAX + 1)
    .filter(t => t.getId() !== excludeThreadId)
    .slice(0, PRIOR_REPLIES_MAX);
  if (threads.length === 0) return [];
  return GmailApp.getMessagesForThreads(threads)
    .map(lastSentByMe_)
    .filter(Boolean)
    .map(m => stripQuotedReplyHistory_(m.getPlainBody() || '').substring(0, VOICE_EXAMPLE_BODY_CAP));
}

function lastSentByMe_(messages) {
  return messages.slice().reverse().find(m => !m.isDraft() && isFromMe_(m.getFrom()));
}

function loadVoiceExamples_() {
  const threads = GmailApp.search('label:sent label:"' + LABEL_VOICE + '" -in:trash', 0, VOICE_EXAMPLES_MAX);
  if (threads.length === 0) return [];
  const messagesByThread = GmailApp.getMessagesForThreads(threads);
  return threads.map((t, i) => {
    const msg = lastSentByMe_(messagesByThread[i]) || messagesByThread[i][0];
    return {
      subject: t.getFirstMessageSubject() || '',
      body: stripQuotedReplyHistory_(msg.getPlainBody() || '').substring(0, VOICE_EXAMPLE_BODY_CAP)
    };
  });
}

function buildReplyPrompt_(ctx) {
  const voiceBlock = ctx.voiceExamples.length === 0
    ? '(none specified)'
    : ctx.voiceExamples.map(e => `Subject: ${e.subject}\n${e.body}`).join('\n---\n');
  const messagesBlock = ctx.messages
    .map(m => `From: ${m.from}  (${m.date})\nTo: ${m.to}${m.cc ? '\nCc: ' + m.cc : ''}\n${m.body}`)
    .join('\n---\n');
  return REPLY_PROMPT(ctx, voiceBlock, messagesBlock);
}

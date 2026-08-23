/*
Drafts a reply that mimics your 🫵-labeled sent emails.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function generateReplyDraft(thread, voiceExamples, userEmail) {
  const apiKey = PropertiesService.getScriptProperties().getProperty(PROPS.GEMINI_API_KEY);
  if (!apiKey) {
    console.log('drafter: GEMINI_API_KEY not set, abstaining.');
    return null;
  }
  const ctx = buildReplyContext_(thread, voiceExamples, userEmail);
  if (!ctx) return null;
  const result = callGemini_(buildReplyPrompt_(ctx), apiKey, { temperature: 0.3, logPrefix: 'drafter' });
  if (!result) return null;
  return { draft: result.draft || '', notes: result.notes || '' };
}

function buildReplyContext_(thread, voiceExamples, userEmail) {
  const subject = thread.getFirstMessageSubject() || '';
  const messages = thread.getMessages().slice(-REPLY_THREAD_MESSAGE_WINDOW).map(m => ({
    from: m.getFrom(),
    date: m.getDate().toISOString(),
    body: stripQuotedReplyHistory_(m.getPlainBody() || '').substring(0, REPLY_MESSAGE_BODY_CAP)
  }));
  return { userEmail, subject, messages, voiceExamples: voiceExamples || [] };
}

function loadVoiceExamples_(userEmail) {
  const threads = GmailApp.search('label:sent label:"' + LABEL_VOICE + '" -in:trash', 0, VOICE_EXAMPLES_MAX);
  if (threads.length === 0) return [];
  const lower = userEmail.toLowerCase();
  const messagesByThread = GmailApp.getMessagesForThreads(threads);
  return threads.map((t, i) => {
    const mine = messagesByThread[i].slice().reverse().find(m => m.getFrom().toLowerCase().includes(lower));
    const msg = mine || messagesByThread[i][0];
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
  const messagesBlock = ctx.messages.map(m => `From: ${m.from}  (${m.date})\n${m.body}`).join('\n---\n');
  return REPLY_PROMPT(ctx, voiceBlock, messagesBlock);
}

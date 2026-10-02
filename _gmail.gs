/*
Advanced Gmail API helpers. GmailApp's daily call quota is small and shared by the whole script;
routines that run every few minutes go through these instead.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

// Thread ids matching q, newest first, at most max.
function searchIds_(q, max = SEARCH_MAX) {
  const ids = [];
  let pageToken;
  do {
    const res = Gmail.Users.Threads.list('me', { q, pageToken, maxResults: max - ids.length, includeSpamTrash: /(^|\s)in:trash/.test(q) });
    (res.threads || []).forEach(t => ids.push(t.id));
    pageToken = res.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids;
}

// { id, subject, labelIds, messages: [{ id, from, to, subject, date, draft }] } from headers only.
function getThread_(id) {
  const messages = Gmail.Users.Threads.get('me', id, { format: 'metadata', metadataHeaders: ['From', 'To', 'Subject'] })
    .messages.map(m => {
      const header = name => ((m.payload.headers || []).find(h => h.name.toLowerCase() === name) || {}).value || '';
      return { id: m.id, from: header('from'), to: header('to'), subject: header('subject'),
        date: Number(m.internalDate), draft: (m.labelIds || []).includes('DRAFT'), labelIds: m.labelIds || [] };
    });
  return { id, subject: messages[0].subject, labelIds: [...new Set(messages.flatMap(m => m.labelIds))], messages };
}

function modifyThreads_(ids, addLabelIds, removeLabelIds) {
  ids.forEach(id => Gmail.Users.Threads.modify({ addLabelIds, removeLabelIds }, 'me', id));
}

let _labelMap = null;

// Id of a user label by name, created on first use.
function labelId_(name) {
  if (!_labelMap) _labelMap = buildLabelMap();
  return getOrCreateLabelCached(_labelMap, name).id;
}

// Decoded text/plain body of a message, or '' when it has none. The service returns body data as
// bytes or as a web-safe base64 string depending on runtime, so both are accepted.
function plainBody_(messageId) {
  const find = p => p.mimeType === 'text/plain' && p.body && p.body.data ? p : (p.parts || []).map(find).find(Boolean);
  const part = find(Gmail.Users.Messages.get('me', messageId, { format: 'full' }).payload);
  if (!part) return '';
  const data = part.body.data;
  return Utilities.newBlob(typeof data === 'string' ? Utilities.base64DecodeWebSafe(data) : data).getDataAsString();
}

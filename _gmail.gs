/*
Advanced Gmail API helpers. GmailApp's daily call quota is small and shared by the whole script;
routines that run every few minutes go through these instead.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

// Last seen historyId per thread id. Gmail bumps it on any new message or label change.
const _historyIds = {};

// Thread ids matching q, newest first, at most max.
function searchIds_(q, max = SEARCH_MAX) {
  const ids = [];
  let pageToken;
  do {
    const res = Gmail.Users.Threads.list('me', { q, pageToken, maxResults: max - ids.length, includeSpamTrash: /(^|\s)in:trash/.test(q) });
    (res.threads || []).forEach(t => { ids.push(t.id); _historyIds[t.id] = t.historyId; });
    pageToken = res.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids;
}

function getThread_(id) {
  return getThreads_([id])[0];
}

// Reads are cached by historyId, so a thread is fetched again only after it changes.
// Ids that didn't come from searchIds_ have no historyId and are always fetched.
function getThreads_(ids) {
  const cache = CacheService.getScriptCache();
  const key = id => _historyIds[id] && THREAD_CACHE_PREFIX + id + ':' + _historyIds[id];
  const hits = cache.getAll(ids.map(key).filter(Boolean));
  const misses = {};
  const threads = ids.map(id => {
    if (hits[key(id)]) return JSON.parse(hits[key(id)]);
    const t = fetchThread_(id);
    const json = JSON.stringify(t);
    if (key(id) && json.length < CACHE_VALUE_MAX_CHARS) misses[key(id)] = json;
    return t;
  });
  cache.putAll(misses, CACHE_MAX_TTL_SEC);
  return threads;
}

// { id, subject, labelIds, messages: [{ id, from, to, subject, date, draft }] } from headers only.
function fetchThread_(id) {
  const messages = Gmail.Users.Threads.get('me', id, { format: 'metadata', metadataHeaders: ['From', 'To', 'Subject'] })
    .messages.map(m => {
      const header = name => ((m.payload.headers || []).find(h => h.name.toLowerCase() === name) || {}).value || '';
      return { id: m.id, from: header('from'), to: header('to'), subject: header('subject'),
        date: Number(m.internalDate), draft: (m.labelIds || []).includes('DRAFT'), labelIds: m.labelIds || [] };
    });
  return { id, subject: messages[0].subject, labelIds: [...new Set(messages.flatMap(m => m.labelIds))], messages };
}

const RUN_STARTED_MS = Date.now();

// Stops at the run's time budget so Apps Script never kills a write midway; returns the ids it changed.
// What's left is picked up by the next run.
function modifyThreads_(ids, addLabelIds, removeLabelIds) {
  const done = [];
  for (const id of ids) {
    if (timeBudgetExceeded(RUN_STARTED_MS)) {
      console.warn('⏱️ Time budget hit, ' + (ids.length - done.length) + ' threads left for the next run');
      break;
    }
    Gmail.Users.Threads.modify({ addLabelIds, removeLabelIds }, 'me', id);
    done.push(id);
  }
  return done;
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

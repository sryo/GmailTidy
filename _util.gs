/*
Shared helpers.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Returns a {nameLowercase: labelResource} map from a single Gmail advanced-service Labels.list call.
function buildLabelMap() {
  var map = {};
  var response = Gmail.Users.Labels.list('me');
  if (response.labels) {
    for (var i = 0; i < response.labels.length; i++) {
      var label = response.labels[i];
      map[label.name.toLowerCase()] = label;
    }
  }
  return map;
}

function createLabelWithPolicy_(name) {
  const vis = labelVisibility(name);
  return Gmail.Users.Labels.create({
    name: name,
    labelListVisibility: vis.label,
    messageListVisibility: vis.message
  }, 'me');
}

// Get-or-create a Gmail advanced-service label, mutating the cache map so subsequent calls in the same run are free.
function getOrCreateLabelCached(labelMap, name) {
  var key = name.toLowerCase();
  if (labelMap[key]) return labelMap[key];
  var created = createLabelWithPolicy_(name);
  labelMap[key] = created;
  return created;
}

function timeBudgetExceeded(startMs) {
  return Date.now() - startMs > EXECUTION_TIME_LIMIT_MS;
}

// Calls fn() and swallows any throw, logging "<label> failed: ...".
// Used to keep one failing subroutine from aborting a cleanup pass.
function safely_(label, fn) {
  try { return fn(); } catch (e) { console.log(label + ' failed: ' + e.toString()); }
}

// Drops quoted reply history ("On ... wrote:" + leading-`>` lines) from a
// plain-text email body. Used by drafter + burndown to get a clean snippet.
function stripQuotedReplyHistory_(text) {
  if (!text) return '';
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^On .+ wrote:\s*$/.test(line.trim())) break;
    if (/^>+/.test(line)) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

function getOrCreateUserLabel(name) {
  let label = GmailApp.getUserLabelByName(name);
  if (label) return label;
  createLabelWithPolicy_(name);
  return GmailApp.getUserLabelByName(name);
}

function appendRowsBatch(sheet, rows) {
  if (!rows || rows.length === 0) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function deleteRowsReverse(sheet, rowNumbers) {
  const sorted = rowNumbers.slice().sort((a, b) => a - b);
  for (let i = sorted.length - 1; i >= 0; i--) sheet.deleteRow(sorted[i]);
}

// Shared Gemini call. Returns parsed response JSON object, or null on any failure.
// opts = { temperature = 0, logPrefix = 'gemini' }
// Retries transient errors (429/5xx + thrown exceptions) with exponential backoff;
// non-retryable 4xx fails fast.
function callGemini_(prompt, apiKey, opts) {
  opts = opts || {};
  const temperature = opts.temperature !== undefined ? opts.temperature : 0;
  const logPrefix = opts.logPrefix || 'gemini';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature, responseMimeType: 'application/json' }
  };
  let lastCode = 0;
  for (let attempt = 1; attempt <= GEMINI_RETRY_MAX_ATTEMPTS; attempt++) {
    let threw = false;
    try {
      const response = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'x-goog-api-key': apiKey },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      });
      const code = response.getResponseCode();
      lastCode = code;
      if (code === 200) {
        const text = JSON.parse(response.getContentText()).candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) return null;
        return JSON.parse(text);
      }
      console.log(`${logPrefix}: API ${code}: ${response.getContentText().substring(0, 200)}`);
      if (GEMINI_RETRY_RETRYABLE_CODES.indexOf(code) < 0) return null;
    } catch (e) {
      threw = true;
      console.log(`${logPrefix}: ${e.toString()}`);
    }
    if (attempt < GEMINI_RETRY_MAX_ATTEMPTS) {
      Utilities.sleep(GEMINI_RETRY_BASE_MS * Math.pow(2, attempt - 1));
    } else if (threw || GEMINI_RETRY_RETRYABLE_CODES.indexOf(lastCode) >= 0) {
      console.log(`${logPrefix}: gave up after ${GEMINI_RETRY_MAX_ATTEMPTS} attempts (lastCode=${lastCode})`);
    }
  }
  return null;
}

// Strips every user label except the ones in keepNames. Used when a thread's labels should be
// reset to a known set (e.g., pretrash carries only 🗑️). Grouped by label so each label costs one
// batch call instead of one call per thread.
function stripAllLabelsExcept(threads, keepNames) {
  if (!threads || threads.length === 0) return;
  const byName = {};
  threads.forEach(t => {
    t.getLabels().forEach(l => {
      const name = l.getName();
      if (keepNames.includes(name)) return;
      if (!byName[name]) byName[name] = { label: l, threads: [] };
      byName[name].threads.push(t);
    });
  });
  Object.keys(byName).forEach(name => {
    const { label, threads: ts } = byName[name];
    inChunks_(ts, c => label.removeFromThreads(c));
  });
}

function removeLabelIfExists_(name, threads) {
  if (!threads || threads.length === 0) return;
  const l = GmailApp.getUserLabelByName(name);
  if (l) inChunks_(threads, c => l.removeFromThreads(c));
}

// Calls fn on consecutive slices of at most GMAIL_BATCH_MAX items.
function inChunks_(items, fn) {
  for (let i = 0; i < items.length; i += GMAIL_BATCH_MAX) fn(items.slice(i, i + GMAIL_BATCH_MAX));
}

function buildDraftMapForThreads_() {
  const map = new Map();
  GmailApp.getDrafts().forEach(d => {
    try { map.set(d.getMessage().getThread().getId(), d); } catch (e) { /* dangling draft */ }
  });
  return map;
}

// One Drafts.list page per 100 drafts, instead of two GmailApp calls per draft.
function buildDraftThreadIdSet_() {
  const ids = new Set();
  let pageToken;
  do {
    const res = Gmail.Users.Drafts.list('me', { pageToken });
    (res.drafts || []).forEach(d => ids.add(d.message.threadId));
    pageToken = res.nextPageToken;
  } while (pageToken);
  return ids;
}

// Quoted-original block so recipients see context, matching Gmail's Reply UI output.
function buildReplyBody_(thread, draftText) {
  const original = thread.getMessages().slice().reverse().find(m => !isFromMe_(m.getFrom()));
  const escapedDraft = escapeHtml(draftText).replace(/\n/g, '<br>');
  if (!original) return { body: draftText, htmlBody: `<div>${escapedDraft}</div>` };

  const attribution = `On ${formatReplyDate_(original.getDate())}, ${original.getFrom()} wrote:`;
  const quotedPlain = (original.getPlainBody() || '').split('\n').map(l => '> ' + l).join('\n');
  const body = `${draftText}\n\n${attribution}\n${quotedPlain}`;

  const htmlBody =
    `<div>${escapedDraft}</div>` +
    `<div><br></div>` +
    `<div>${escapeHtml(attribution)}</div>` +
    `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex;">${original.getBody() || ''}</blockquote>`;

  return { body, htmlBody };
}

function formatReplyDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), "EEE, MMM d, yyyy 'at' h:mm a");
}

function hasIncomingSince_(thread, sinceMs) {
  return thread.getMessages().some(m => !m.isDraft() && !isFromMe_(m.getFrom()) && m.getDate().getTime() > sinceMs);
}

function wasReplySentAfter_(thread, sinceTimestamp) {
  const since = new Date(sinceTimestamp);
  return thread.getMessages().some(m => !m.isDraft() && isFromMe_(m.getFrom()) && m.getDate() > since);
}

let _userEmailCache = null;
let _myAddressesCache = null;

function userEmail_() {
  if (!_userEmailCache) _userEmailCache = Gmail.Users.getProfile('me').emailAddress;
  return _userEmailCache;
}

// Exact address match against the account and its Send-As aliases. A substring or from:me check
// false-matches lookalike addresses and misses alias sends.
function isFromMe_(fromHeader) {
  if (!_myAddressesCache) _myAddressesCache = new Set([userEmail_()].concat(GmailApp.getAliases()).map(a => a.toLowerCase()));
  const m = (fromHeader || '').match(/<([^>]+)>/);
  return _myAddressesCache.has((m ? m[1] : fromHeader || '').trim().toLowerCase());
}

/*
Bunches important threads by sender domain. Sweeps empty user labels.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function bunch() {
  const startMs = Date.now();
  const labelMap = buildLabelMap();
  const domainsAdded = new Set();
  let threadsLabeled = 0;
  let pageToken;

  do {
    try {
      if (timeBudgetExceeded(startMs)) {
        console.warn('🏷️ Bunch: time budget hit, resuming next run');
        break;
      }
      const threads = fetchBunchThreads_(pageToken);
      if (!threads || !threads.threads || threads.threads.length === 0) break;
      threadsLabeled += bunchThreads_(threads.threads, labelMap, domainsAdded);
      pageToken = threads.nextPageToken;
    } catch (e) {
      console.error('🏷️ Bunch failed: ' + e.toString());
      break;
    }
  } while (pageToken);

  if (threadsLabeled > 0) console.log('🏷️ Bunched ' + threadsLabeled + ' threads: ' + [...domainsAdded].join(', '));
}

// Recent window only: a late-joining sender arrives as a new message, so it lands inside the window.
// Idempotent: only adds missing domain labels per thread.
function fetchBunchThreads_(pageToken) {
  return Gmail.Users.Threads.list('me', {
    q: 'is:important newer_than:' + BUNCH_WINDOW_DAYS + 'd -' + PRETRASH_CATEGORY_QUERY + ' -in:trash',
    maxResults: MAX_THREADS_TAG,
    pageToken: pageToken
  });
}

// Returns how many threads got new labels; collects the added domains into domainsAdded.
function bunchThreads_(threads, labelMap, domainsAdded) {
  let labeled = 0;
  for (const thread of threads) {
    try {
      const threadDetails = Gmail.Users.Threads.get('me', thread.id, {
        format: 'metadata',
        metadataHeaders: SENDER_HEADER_FALLBACKS
      });
      if (!threadDetails || !threadDetails.messages) continue;

      const existingLabelIds = new Set();
      const domains = new Set();
      let sawOwn = false;
      for (const message of threadDetails.messages) {
        (message.labelIds || []).forEach(id => existingLabelIds.add(id));
        if (!message.payload || !message.payload.headers) continue;
        const sender = getSenderFromHeaders_(message.payload.headers);
        if (!sender) continue;
        if (isFromMe_(sender)) { sawOwn = true; continue; }
        const domain = extractDomain_(sender);
        if (domain) domains.add(domain);
        else console.warn('🏷️ Bunch: no domain in sender ' + sender);
      }

      // Own messages label nothing; the fallback is only for threads with no readable sender at all.
      const targetDomains = domains.size > 0 ? [...domains] : sawOwn ? [] : [FALLBACK_SENDER_DOMAIN];
      const missing = targetDomains.filter(d => {
        const existing = labelMap[d.toLowerCase()];
        return !existing || !existingLabelIds.has(existing.id);
      });
      if (missing.length === 0) continue;

      const addLabelIds = missing.map(d => getOrCreateLabelCached(labelMap, d).id);
      Gmail.Users.Threads.modify({ addLabelIds }, 'me', thread.id);
      missing.forEach(d => domainsAdded.add(d));
      labeled++;
    } catch (e) {
      console.error('🏷️ Bunch failed on ' + thread.id + ': ' + e.toString());
    }
  }
  return labeled;
}

function getSenderFromHeaders_(headers) {
  for (const name of SENDER_HEADER_FALLBACKS) {
    const h = headers.find(header => header.name === name);
    if (h && h.value) return h.value;
  }
  return null;
}

function extractDomain_(sender) {
  const match = sender.match(/@([a-zA-Z0-9.-]+)/);
  return match ? match[1] : null;
}

// Sweeps user labels in pages of REMOVE_EMPTY_LABELS_BATCH; resumes via PROPS.OFFSET across runs.
function removeEmptyLabels() {
  const labels = GmailApp.getUserLabels();
  const limit = REMOVE_EMPTY_LABELS_BATCH;
  const userProperties = PropertiesService.getUserProperties();
  let offset = parseInt(userProperties.getProperty(PROPS.OFFSET), 10);
  if (isNaN(offset) || offset >= labels.length) offset = 0;

  if (labels.length > 0) {
    const end = Math.min(offset + limit, labels.length);
    const filled = Math.min(10, Math.floor(end / labels.length * 10));
    console.log('🟩'.repeat(filled) + '⬜'.repeat(10 - filled) + ' ' + offset + '-' + end + ' / ' + labels.length);
  }

  let i;
  for (i = offset; i < offset + limit && i < labels.length; i++) {
    const name = labels[i].getName();
    if (PROTECTED_LABELS.includes(name)) continue;
    if (labels[i].getThreads(0, 1).length === 0) {
      labels[i].deleteLabel();
      console.log('🏷️ Deleted empty label: ' + name);
    }
  }
  userProperties.setProperty(PROPS.OFFSET, i);
}

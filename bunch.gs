/*
Bunches important threads by sender domain. Sweeps empty user labels.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

// From/Sender only. Reply-To and Return-Path lie about the actual sender (mailing-list relays,
// bounce addresses) and produced wrong domain labels when From was missing.
const SENDER_HEADER_FALLBACKS = ['From', 'Sender'];
const FALLBACK_SENDER_DOMAIN = 'unknown.sender';

function bunch() {
  const startMs = Date.now();
  const labelMap = buildLabelMap();
  let pageToken;

  do {
    try {
      if (timeBudgetExceeded(startMs)) {
        console.log('Time budget exceeded; will resume on next trigger.');
        break;
      }
      const threads = fetchThreads(pageToken);
      if (!threads || !threads.threads || threads.threads.length === 0) {
        console.log("No more threads to process.");
        break;
      }
      const added = processThreads(threads.threads, labelMap);
      if (!added) console.log(`No new labels were added in this run.`);
      pageToken = threads.nextPageToken;
    } catch (e) {
      console.error(`An error occurred during execution: ${e.toString()}`);
      break;
    }
  } while (pageToken);

  console.log("Script execution finished.");
}

// is:unread re-includes already-tagged threads when new mail arrives, so late-joining senders
// can be labeled. Idempotent: only adds missing domain labels per thread.
function fetchThreads(pageToken) {
  return Gmail.Users.Threads.list('me', {
    q: 'is:important is:unread -' + PRETRASH_CATEGORY_QUERY + ' -in:trash',
    maxResults: MAX_THREADS_TAG,
    pageToken: pageToken
  });
}

function processThreads(threads, labelMap) {
  let added = false;
  for (const thread of threads) {
    try {
      const threadDetails = Gmail.Users.Threads.get('me', thread.id, {
        format: 'metadata',
        metadataHeaders: SENDER_HEADER_FALLBACKS
      });
      if (!threadDetails || !threadDetails.messages) continue;

      const existingLabelIds = new Set();
      const domains = new Set();
      for (const message of threadDetails.messages) {
        (message.labelIds || []).forEach(id => existingLabelIds.add(id));
        if (!message.payload || !message.payload.headers) continue;
        const sender = getSenderFromHeaders(message.payload.headers);
        if (!sender) continue;
        const domain = extractDomain(sender);
        if (domain) domains.add(domain);
        else console.log(`Could not extract domain from '${sender}' in thread: ${thread.id}`);
      }

      const targetDomains = domains.size > 0 ? [...domains] : [FALLBACK_SENDER_DOMAIN];
      const missing = targetDomains.filter(d => {
        const existing = labelMap[d.toLowerCase()];
        return !existing || !existingLabelIds.has(existing.id);
      });
      if (missing.length === 0) continue;

      const addLabelIds = missing.map(d => getOrCreateLabelCached(labelMap, d).id);
      Gmail.Users.Threads.modify({ addLabelIds }, 'me', thread.id);
      Logger.log(`Added ${missing.length} domain label(s) to thread ${thread.id}: ${missing.join(', ')}`);
      added = true;
    } catch (e) {
      console.error(`Failed to process thread ${thread.id}. Error: ${e.toString()}`);
    }
  }
  return added;
}

function getSenderFromHeaders(headers) {
  for (const name of SENDER_HEADER_FALLBACKS) {
    const h = headers.find(header => header.name === name);
    if (h && h.value) return h.value;
  }
  return null;
}

function extractDomain(sender) {
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

  if (labels.length === 0) {
    Logger.log("No labels to process.");
  } else {
    const end = Math.min(offset + limit, labels.length);
    const filled = Math.min(10, Math.floor(end / labels.length * 10));
    Logger.log('🟩'.repeat(filled) + '⬜'.repeat(10 - filled) + ' ' + offset + '-' + end + ' / ' + labels.length);
  }

  let i;
  for (i = offset; i < offset + limit && i < labels.length; i++) {
    const name = labels[i].getName();
    if (PROTECTED_LABELS.includes(name)) continue;
    if (labels[i].getThreads().length === 0) {
      labels[i].deleteLabel();
      Logger.log('🏷️ Deleted empty label: ' + name);
    }
  }
  userProperties.setProperty(PROPS.OFFSET, i);
}

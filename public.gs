/*
Share Gmail threads labeled 🌎 Public as a web page.
Author: Mateo Yadarola (teodalton@gmail.com)

Served by doGet when this project is deployed as a web app ("Execute as: Me", "Who has access:
Anyone"). Only 🌎-labeled threads are ever rendered: applying the label is the decision to publish.
*/

// Conservative deny-list sanitizer for HTML email bodies before embedding in a web-app page.
// Personal-use scope: blocks script execution, dangerous URL schemes, and remote images (sender tracking
// pixels would fire for every viewer) without preserving rich formatting perfectly.
function sanitizeEmailHtml(html) {
  if (!html) return '';
  var s = html;
  s = s.replace(/<(script|iframe|object|embed|style|link|meta|base)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  s = s.replace(/<(script|iframe|object|embed|style|link|meta|base)\b[^>]*\/?>/gi, '');
  s = s.replace(/<img\b[^>]*\ssrc\s*=\s*["']?\s*(?:https?:)?\/\/[^>]*>/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '');
  s = s.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '');
  s = s.replace(/(href|src|action|formaction)\s*=\s*(?:"\s*(?:javascript|data:text\/html)[^"]*"|'\s*(?:javascript|data:text\/html)[^']*'|(?:javascript|data:text\/html)[^\s>]*)/gi, '$1="#"');
  return s;
}

function getThreadsInLabel(labelName) {
  try {
    const label = GmailApp.getUserLabelByName(labelName);
    if (!label) {
      console.log(`Label "${labelName}" not found.`);
      return [];
    }

    const threads = label.getThreads(0, PUBLIC_MAX_THREADS);
    const messagesByThread = GmailApp.getMessagesForThreads(threads);

    return threads.map((thread, idx) => {
      try {
        const messages = messagesByThread[idx] || [];
        return {
          id: thread.getId(),
          subject: thread.getFirstMessageSubject() || '(No subject)',
          lastMessageDate: thread.getLastMessageDate().toISOString(),
          messages: messages.map(message => ({
            id: message.getId(),
            subject: message.getSubject(),
            body: message.getBody(),
            from: message.getFrom(),
            date: message.getDate().toISOString()
          }))
        };
      } catch (e) {
        console.error(`Failed to process thread: ${e.toString()}`);
        return null;
      }
    }).filter(Boolean);
  } catch (e) {
    console.error(`Failed to get threads: ${e.toString()}`);
    return [];
  }
}

function writeThreadsToHtml(threadArray) {
  const messageCount = threadArray.reduce((count, thread) => count + thread.messages.length, 0);
  console.log(`Showing ${threadArray.length} threads with ${messageCount} messages`);

  const threadHtml = threadArray.map(thread => `
    <div class="thread" data-date="${thread.lastMessageDate}" data-subject="${escapeHtml(thread.subject)}">
      <h2 class='thread-subject'>${escapeHtml(thread.subject)}</h2>
      ${thread.messages.map(message => `
        <div class="message">
          <div class="message-header">
            <span class="from">${escapeHtml(message.from)}</span>
            <span class="date">${new Date(message.date).toLocaleString()}</span>
          </div>
          <div class="message-body">${sanitizeEmailHtml(message.body)}</div>
        </div>
      `).join('')}
    </div>
  `).join('');

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Public Threads</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
          }
          h1 { color: #2c3e50; }
          .thread {
            background: #f9f9f9;
            border: 1px solid #ddd;
            border-radius: 5px;
            padding: 15px;
            margin-bottom: 20px;
          }
          .thread-subject {
            color: #34495e;
            margin-top: 0;
          }
          .message {
            border-top: 1px solid #eee;
            padding-top: 10px;
            margin-top: 10px;
          }
          .message-header {
            font-size: 0.9em;
            color: #7f8c8d;
            margin-bottom: 5px;
          }
          .message-body {
            margin-top: 10px;
          }
          .message-body img {
            max-width: 100%;
            height: auto;
          }
          #sortSelect {
            margin-bottom: 20px;
          }
        </style>
        <script>
          function sortThreads(sortBy) {
            const threadContainer = document.getElementById('threadContainer');
            const threads = Array.from(threadContainer.children);

            threads.sort((a, b) => {
              const aValue = a.getAttribute('data-' + sortBy);
              const bValue = b.getAttribute('data-' + sortBy);
              if (sortBy === 'date') {
                return new Date(bValue) - new Date(aValue);
              } else {
                return aValue.localeCompare(bValue);
              }
            });

            threads.forEach(thread => threadContainer.appendChild(thread));
          }
        </script>
      </head>
      <body>
        <h1>Public Threads</h1>
        <p style="color: #7f8c8d; margin-bottom: 15px;">${threadArray.length} threads, ${messageCount} messages</p>
        <select id="sortSelect" onchange="sortThreads(this.value)">
          <option value="date">Sort by Date</option>
          <option value="subject">Sort by Subject</option>
        </select>
        <div id="threadContainer">
          ${threadHtml}
        </div>
      </body>
    </html>
  `;
}

function publishPublicThreads() {
  const cache = CacheService.getScriptCache();
  let html = cache.get(PUBLIC_CACHE_KEY);
  if (!html) {
    const threads = getThreadsInLabel(LABEL_PUBLIC);
    html = writeThreadsToHtml(threads);
    try {
      cache.put(PUBLIC_CACHE_KEY, html, PUBLIC_CACHE_TTL_SEC);
    } catch (e) {
      console.log(`Skipped caching (likely >100KB): ${e.toString()}`);
    }
  }

  return HtmlService.createHtmlOutput(html)
    .setTitle("Public Threads")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// The editor reports the owner-only /dev URL, so only a live /exec request can tell us the shareable one.
function mailPublicUrlOnce_() {
  const props = PropertiesService.getScriptProperties();
  const url = ScriptApp.getService().getUrl();
  if (!url || !url.endsWith('/exec') || props.getProperty(PROPS.PUBLIC_URL_SENT) === url) return;
  GmailApp.sendEmail(userEmail_(), PUBLIC_URL_SUBJECT, url);
  props.setProperty(PROPS.PUBLIC_URL_SENT, url);
}

function doGet() {
  try {
    mailPublicUrlOnce_();
  } catch (e) {
    console.error(`Failed to mail public URL: ${e.toString()}`);
  }
  return publishPublicThreads();
}

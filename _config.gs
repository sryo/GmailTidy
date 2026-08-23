/*
Shared constants.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

const LABEL_AUTOREPLY = '🦾 Riff';
const LABEL_PUBLIC = '🌎 Public';
const LABEL_PRETRASH = '🗑️';
const LABEL_PING = '↩️ Ping';
const LABEL_STASH = '🪎 Stash';
const LABEL_VOICE = '🫵 Voice';

// Labels removeEmptyLabels must never delete, even when empty.
const PROTECTED_LABELS = [LABEL_AUTOREPLY, LABEL_PUBLIC, LABEL_PRETRASH, LABEL_PING, LABEL_STASH, LABEL_VOICE];

// Per-label visibility applied at creation only; existing labels are left as-is.
// `label` is Gmail's labelListVisibility ('labelShow'/'labelHide'); `message` is messageListVisibility ('show'/'hide').
const LABEL_VISIBILITY_POLICY = {
  [LABEL_AUTOREPLY]: { label: 'labelShow', message: 'show' },
  [LABEL_PUBLIC]:    { label: 'labelShow', message: 'show' },
  [LABEL_PING]:      { label: 'labelShow', message: 'show' },
  [LABEL_VOICE]:     { label: 'labelShow', message: 'show' },
  [LABEL_STASH]:     { label: 'labelShow', message: 'hide' },
  [LABEL_PRETRASH]:  { label: 'labelShow', message: 'hide' }
};
const LABEL_VISIBILITY_DEFAULT = { label: 'labelHide', message: 'show' };

function labelVisibility(name) {
  return LABEL_VISIBILITY_POLICY[name] || LABEL_VISIBILITY_DEFAULT;
}

const MAX_THREADS_TAG = 25;
const REMOVE_EMPTY_LABELS_BATCH = 50;

const EXECUTION_TIME_LIMIT_MS = 5 * 60 * 1000;

const TRACKING_SPREADSHEET_NAME = 'GmailTidy';
const GEMINI_MODEL = 'gemini-3.5-flash';
const GEMINI_RETRY_MAX_ATTEMPTS = 3;
const GEMINI_RETRY_BASE_MS = 500;
const GEMINI_RETRY_RETRYABLE_CODES = [429, 500, 502, 503, 504];
const PRETRASH_CATEGORY_QUERY = '(label:low_priority OR label:promos OR category:updates)';
const PRETRASH_AGE_DAYS = 20;
const ARCHIVE_INBOX_AGE_DAYS = 1;
const PING_PICKUP_DAYS = 2;
const PING_EXPIRE_DAYS = 4;
const AUTOREPLY_BATCH_LIMIT = 5;
const AUTOREPLY_DRY_RUN = false;
const VOICE_EXAMPLES_MAX = 10; // recommended; do not exceed 10 or prompt grows unwieldy
const VOICE_EXAMPLE_BODY_CAP = 1000;
const REPLY_THREAD_MESSAGE_WINDOW = 5;
const REPLY_MESSAGE_BODY_CAP = 4000;
const BURNDOWN_LIMIT = 15;
const BURNDOWN_AUTOSEND = false;
const BURNDOWN_HOUR = 8;
const BURNDOWN_SNIPPET_CAP = 240;
const BURNDOWN_SUBJECT_PREFIX = 'Burndown';
const BURNDOWN_MARKER_PREFIX = '━ thread ';
const BURNDOWN_TABLE_HEADER_LEFT = 'Mail';
const BURNDOWN_TABLE_HEADER_RIGHT = 'Your reply';
const BURNDOWN_REPLY_PROMPT = 'Your reply:';
const BURNDOWN_QUERY = 'is:important is:unread in:inbox -label:sent -label:' + LABEL_PRETRASH + ' -label:"' + LABEL_PUBLIC + '" newer_than:7d';
const BURNDOWN_PROCESSED_TTL_DAYS = 14;

const TRACKING_TYPE_PINGED = 'pinged';
const TRACKING_TYPE_DRAFTED = 'drafted';
const TRACKING_TYPE_BURNDOWN_PROCESSED = 'burndown_processed';

const SHEET_TAB_TRACKING = 'Tracking';
const TRACKING_HEADERS = ['threadId', 'type', 'timestamp'];

const PROPS = {
  OFFSET: 'offset',
  TRACKING_SHEET_ID: 'CLASSIFIER_SHEET_ID', // key string predates the rename; kept so existing installs keep their sheet
  GEMINI_API_KEY: 'GEMINI_API_KEY'
};

const TRIGGER_CLEANUP_MIN = 5;
const TRIGGER_CLEANUP_DEEP_MIN = 15;
const TRIGGER_BUNCH_MIN = 5;
const TRIGGER_REMOVE_EMPTY_LABELS_MIN = 30;
const TRIGGER_DAILY_MAINTENANCE_HOUR = 4;
const TRIGGER_CLEANUP_HANDLER = 'cleanUp';
const TRIGGER_CLEANUP_DEEP_HANDLER = 'cleanUpDeep';
const TRIGGER_BUNCH_HANDLER = 'bunch';
const TRIGGER_REMOVE_EMPTY_LABELS_HANDLER = 'removeEmptyLabels';
const TRIGGER_BURNDOWN_HANDLER = 'sendBurndown';
const TRIGGER_DAILY_MAINTENANCE_HANDLER = 'dailyMaintenance';
const MENU_HANDLER = 'addMenu';

const REPLY_PROMPT = (ctx, voiceBlock, messagesBlock) => `You draft a concise email reply on behalf of ${ctx.userEmail}.

User's voice. These threads contain (a) writing samples to mimic for style, (b) any writing principles to follow as rules, and (c) biographical facts (CV, current role, history) you can use as known facts about the user:
---
${voiceBlock}
---

Rules:
- Detect the language of the most recent incoming message NOT from ${ctx.userEmail}; reply in THAT language. This OVERRIDES the voice samples, which may be in a different language: translate the voice's style into the reply's language, do not copy the voice samples' language.
- Reply as ${ctx.userEmail} to the most recent message NOT from that address.
- Match the register of the incoming message (formal vs. casual, terse vs. expansive).
- For style (word choice, sentence rhythm, openings, sign-offs): mimic the voice samples above when provided; otherwise default to plain, direct, conversational, with no filler openings ("Hope you're well") and no corporate stiffness.
- Under 120 words unless the thread clearly demands more.
- Do NOT include a subject line, greeting boilerplate, or signature (Gmail adds the signature).
- Treat biographical facts in the voice samples (CV, current role, skills, history) as true facts about the user that can be referenced in drafts.
- Don't invent specific facts beyond what's in the thread or voice samples.
- Read the thread to judge the response: engage positively with opportunities that align with the user's CV (e.g., job offers matching their background), decline misaligned pitches politely, defer when only the user can answer (e.g., scheduling).
- Return draft:"" only as a last resort (e.g., the message is empty or nonsensical).

Edge cases (return draft:"" with a notes line explaining):
- Thread has no message from anyone other than ${ctx.userEmail}.
- The most recent message is already from ${ctx.userEmail} (user already replied).
- Transactional: booking/flight/ticket confirmation, order receipt, shipment update, OTP, password reset, policy or document delivery, medical or appointment confirmation.
- Marketing or one-way announcement: newsletter, product launch, promo, subscription welcome, "your X is ready" notifications.
- Closing acknowledgment: the most recent incoming message is a brief thanks with no question or request, after the user already replied.
- Out-of-office or vacation auto-responder.

Thread subject: ${ctx.subject}

Messages (oldest first, quoted history removed):
---
${messagesBlock}
---

Respond with JSON only:
{"detectedLanguage": "ISO 639-1 code of the most recent incoming message, e.g., 'en', 'es', 'fr'", "draft": "string", "confidence": 0.0-1.0, "notes": "string or empty"}`;

const BURNDOWN_SUMMARY_PROMPT = (itemsBlock) => `You write one-sentence summaries of unread email threads for a daily reply digest.

Rules:
- One sentence per thread, under 20 words.
- Lead with the ask or the fact, not "the sender". Skip "this email is about".
- Reply in the language of the thread (detect from subject + snippet).
- Stay neutral; don't editorialize.

Threads (one per id):
${itemsBlock}

Respond with JSON only:
{"summaries": [{"id": "...", "summary": "..."}, ...]}`;

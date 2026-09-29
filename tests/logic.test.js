// Pure-logic tests. Run: node --test tests/
// Loads the .gs sources into one vm context with just enough Apps Script stubs for top-level code.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = vm.createContext({
  Gmail: { Users: { getProfile: () => ({ emailAddress: 'me@example.com' }) } },
  GmailApp: { getAliases: () => ['Alias@Example.org'] },
});
const root = path.join(__dirname, '..');
['_config.gs', '_util.gs', '_llmReplyDrafter.gs', 'burndown.gs', 'bunch.gs', 'cleanUp.gs', 'public.gs'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
const run = src => vm.runInContext(src, ctx);

test('burndown digest round-trips through the HTML and plain parsers', () => {
  const items = [
    { threadId: 'abc123', sender: 'A <a@x.com>', subject: 'Hi', snippet: 's', summary: 'sum', due: '2026-10-02', riffDraft: 'Sure, Tuesday.' },
    { threadId: 'def456', sender: 'B <b@y.com>', subject: 'Yo', snippet: 's', summary: '', riffDraft: '' },
  ];
  ctx.items = items;
  const { plainBody, htmlBody } = run('composeBurndownBody_(items)');
  assert.ok(plainBody.includes('- 2026-10-02: sum') && htmlBody.includes('<li>2026-10-02: sum</li>'));
  const expected = [{ threadId: 'abc123', replyText: 'Sure, Tuesday.' }, { threadId: 'def456', replyText: '' }];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(run('parseBurndownHtml_')(htmlBody))), expected);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(run('parseBurndownPlain_')(plainBody))), expected);
});

test('isFromMe_ matches the account and aliases exactly', () => {
  const isFromMe = run('isFromMe_');
  assert.ok(isFromMe('Me <ME@example.com>'));
  assert.ok(isFromMe('alias@example.org'));
  assert.ok(!isFromMe('Other <xme@example.com>'));
  assert.ok(!isFromMe(''));
});

test('reply prompt carries recipients, prior replies, and the redraft rule', () => {
  ctx.replyCtx = {
    userEmail: 'me@example.com', subject: 'S', voiceExamples: [], priorReplies: ['Sounds good, ship it.'], redraft: true,
    messages: [{ from: 'A <a@x.com>', to: 'me@example.com', cc: 'c@x.com', date: 'd', body: 'b' }],
  };
  const prompt = run('buildReplyPrompt_(replyCtx)');
  assert.ok(prompt.includes('To: me@example.com\nCc: c@x.com'));
  assert.ok(prompt.includes('Sounds good, ship it.'));
  assert.ok(prompt.includes('discarded a previous draft'));
  ctx.replyCtx.redraft = false;
  assert.ok(!run('buildReplyPrompt_(replyCtx)').includes('discarded a previous draft'));
});

test('reply prompt switches to a follow-up when the user sent last', () => {
  ctx.nudgeCtx = { userEmail: 'me@example.com', subject: 'S', voiceExamples: [], priorReplies: [], redraft: false, nudge: true, messages: [] };
  const prompt = run('buildReplyPrompt_(nudgeCtx)');
  assert.ok(prompt.includes('got no answer'));
  assert.ok(!prompt.includes('most recent message is already from'));
});

test('extractAddress_ reads the first address in any header shape', () => {
  const extract = run('extractAddress_');
  assert.strictEqual(extract('Bob <Bob@X.com>'), 'bob@x.com');
  assert.strictEqual(extract('"Doe, Jo" <jo@x.com>, b@y.com'), 'jo@x.com');
  assert.strictEqual(extract('a@x.com, b@y.com'), 'a@x.com');
  assert.strictEqual(extract(''), '');
});

test('businessDaysSince_ skips weekends', () => {
  const since = run('businessDaysSince_');
  const fri = new Date(2026, 8, 25, 12).getTime();
  assert.strictEqual(since(fri, new Date(2026, 8, 28, 12).getTime()), 1);
  assert.strictEqual(since(fri, new Date(2026, 8, 30, 12).getTime()), 3);
});

test('recurringSubjectKey_ masks numbers so recurring mail groups', () => {
  const key = run('recurringSubjectKey_');
  assert.strictEqual(key('Build #481 passed'), key('Build #482  passed'));
  assert.notStrictEqual(key('Build passed'), key('Build failed'));
});

test('stripQuotedReplyHistory_ drops quoted history', () => {
  assert.strictEqual(run('stripQuotedReplyHistory_')('Yes.\n\nOn Mon, A wrote:\n> old'), 'Yes.');
});

test('extractDomain_ reads the sender domain', () => {
  assert.strictEqual(run('extractDomain_')('Bob <bob@mail.example.com>'), 'mail.example.com');
  assert.strictEqual(run('extractDomain_')('no address'), null);
});

test('sanitizeEmailHtml strips scripts, handlers, script URLs, and remote images', () => {
  const clean = run('sanitizeEmailHtml')(
    '<p onclick="x()">hi</p><script>alert(1)</script>' +
    '<a href="javascript:x()">a</a><a href=javascript:x()>b</a><img src=x onerror=x()>' +
    '<img alt=t src="https://t.co/p.gif"><img src=//t.co/p.gif>');
  assert.ok(!/script|onclick|onerror|javascript|t\.co/i.test(clean), clean);
  assert.ok(clean.includes('<p>hi</p>'));
});

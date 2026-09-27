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
['_config.gs', '_util.gs', 'burndown.gs', 'bunch.gs'].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
const run = src => vm.runInContext(src, ctx);

test('burndown digest round-trips through the HTML and plain parsers', () => {
  const items = [
    { threadId: 'abc123', sender: 'A <a@x.com>', subject: 'Hi', snippet: 's', summary: 'sum', riffDraft: 'Sure, Tuesday.' },
    { threadId: 'def456', sender: 'B <b@y.com>', subject: 'Yo', snippet: 's', summary: '', riffDraft: '' },
  ];
  ctx.items = items;
  const { plainBody, htmlBody } = run('composeBurndownBody_(items)');
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

test('stripQuotedReplyHistory_ drops quoted history', () => {
  assert.strictEqual(run('stripQuotedReplyHistory_')('Yes.\n\nOn Mon, A wrote:\n> old'), 'Yes.');
});

test('extractDomain_ reads the sender domain', () => {
  assert.strictEqual(run('extractDomain_')('Bob <bob@mail.example.com>'), 'mail.example.com');
  assert.strictEqual(run('extractDomain_')('no address'), null);
});

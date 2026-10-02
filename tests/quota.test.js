// Scheduled routines must not spend GmailApp's small daily quota when there's nothing to act on.
// Runs them against a fake Advanced Gmail mailbox with a GmailApp that throws on any use.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ME = 'me@example.com';
const DAY = 24 * 3600 * 1000;
const b64 = s => Buffer.from(s).toString('base64url');

function msg(id, from, opts = {}) {
  const headers = [{ name: 'From', value: from }, { name: 'To', value: opts.to || ME }, { name: 'Subject', value: opts.subject || 'S' }];
  return {
    id, internalDate: String(opts.date || Date.now()), labelIds: opts.labelIds || [],
    payload: { mimeType: 'text/plain', headers, body: { data: b64(opts.body || 'hi') } },
  };
}

// threadsByQuery: [[substring of q, [threadId...]]]; first match wins, anything else is empty.
function mailbox({ threads = {}, threadsByQuery = [], drafts = [], tracking = [] }) {
  const gmailAppUses = [];
  const errors = [];
  const modified = [];
  const messages = Object.values(threads).flatMap(t => t.messages);
  const ctx = vm.createContext({
    console: { log() {}, warn() {}, error: (...a) => errors.push(a.join(' ')) },
    GmailApp: new Proxy({}, { get: (_, name) => { gmailAppUses.push(name); throw new Error('GmailApp.' + String(name)); } }),
    CacheService: { getScriptCache: () => {
      const store = {};
      return { get: k => store[k] ?? null, put: (k, v) => { store[k] = v; },
        getAll: ks => Object.fromEntries(ks.filter(k => k in store).map(k => [k, store[k]])), putAll: o => Object.assign(store, o) };
    } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Gmail: { Users: {
      getProfile: () => ({ emailAddress: ME }),
      Settings: { SendAs: { list: () => ({ sendAs: [{ sendAsEmail: ME }] }) }, Filters: { list: () => ({}) } },
      Labels: { list: () => ({ labels: [] }), create: l => ({ ...l, id: 'Label_' + l.name }) },
      Threads: {
        list: (_, { q }) => {
          const hit = threadsByQuery.find(([s]) => q.includes(s));
          return { threads: (hit ? hit[1] : []).map(id => ({ id, historyId: '1' })) };
        },
        get: (_, id) => threads[id],
        modify: (body, _, id) => { modified.push([id, body.removeLabelIds]); },
      },
      Messages: { get: (_, id) => messages.find(m => m.id === id) },
      Drafts: { list: () => ({ drafts: drafts.map(threadId => ({ message: { threadId } })) }) },
    } },
  });
  fs.readdirSync(root).filter(f => f.endsWith('.gs')).forEach(f =>
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }));
  ctx.getTrackingValues_ = () => [['threadId', 'type', 'timestamp'], ...tracking];
  return { ctx, gmailAppUses, errors, modified };
}

test('cleanUp spends no GmailApp quota', () => {
  const { ctx, gmailAppUses, errors } = mailbox({});
  vm.runInContext('cleanUp()', ctx);
  assert.deepStrictEqual(gmailAppUses, []);
  assert.deepStrictEqual(errors, []);
});

test('riff spends no GmailApp quota while every 🦾 thread already has a draft', () => {
  const { ctx, gmailAppUses, errors } = mailbox({
    threads: { t1: { id: 't1', messages: [msg('m1', 'a@x.com')] } },
    threadsByQuery: [['🦾', ['t1']]],
    drafts: ['t1'],
    tracking: [['t1', 'drafted', new Date().toISOString()]],
  });
  vm.runInContext('riff()', ctx);
  assert.deepStrictEqual(gmailAppUses, []);
  assert.deepStrictEqual(errors, []);
});

test('processBurndownReplies_ spends no GmailApp quota when every reply is processed', () => {
  const sent = Date.now() - DAY;
  const { ctx, gmailAppUses, errors } = mailbox({
    threads: { d1: { id: 'd1', messages: [msg('dm0', ME, { date: sent }), msg('dm1', ME, { date: sent + 1000 })] } },
    threadsByQuery: [['Burndown', ['d1']]],
    tracking: [['dm1', 'burndown_processed', new Date().toISOString()]],
  });
  vm.runInContext('processBurndownReplies_()', ctx);
  assert.deepStrictEqual(gmailAppUses, []);
  assert.deepStrictEqual(errors, []);
});

test('riff drops 🦾 from a thread whose draft you sent, without GmailApp', () => {
  const draftedAt = Date.now() - DAY;
  const { ctx, gmailAppUses, errors, modified } = mailbox({
    threads: { t1: { id: 't1', messages: [msg('m1', 'a@x.com', { date: draftedAt - DAY }), msg('m2', ME, { date: draftedAt + 1000 })] } },
    threadsByQuery: [['🦾', ['t1']]],
    tracking: [['t1', 'drafted', new Date(draftedAt).toISOString()]],
  });
  ctx.deleteTrackingRows_ = () => {};
  vm.runInContext('riff()', ctx);
  assert.deepStrictEqual(gmailAppUses, []);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(modified)), [['t1', ['Label_🦾 Riff']]]);
});

test('cleanUp pretrashes an unimportant inbox thread from a stranger, without GmailApp', () => {
  const { ctx, gmailAppUses, errors, modified } = mailbox({
    threads: { t1: { id: 't1', messages: [msg('m1', 'promo@shop.com', { labelIds: ['INBOX', 'Label_shop.com'] })] } },
    threadsByQuery: [['in:inbox -label:🗑️', ['t1']]],
  });
  const recorded = [];
  ctx.recordTrackingRows = (ids, type) => recorded.push([...ids, type]);
  vm.runInContext('cleanUp()', ctx);
  assert.deepStrictEqual(gmailAppUses, []);
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(modified)), [['t1', ['Label_shop.com', 'INBOX', 'IMPORTANT']]]);
  assert.deepStrictEqual(recorded, [['t1', 'pretrashed']]);
});

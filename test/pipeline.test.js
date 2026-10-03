const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/database');
const { extractArticles } = require('../src/sources/web-scraper');
const { parseSummary, summarizeArticle, summarizeUntil } = require('../src/summarizer');
const { rankArticles, parseRanking } = require('../src/ranker');
const { curate, formatDigest, chunkMessage } = require('../src/formatter');
const { sendDigest } = require('../src/whatsapp-sender');

const art = (n, source = 'S', extra = {}) => ({ title: `Title ${n}`, link: `https://x.com/p/${n}`, source, category: 'c', snippet: 's', ...extra });

test('database deduplicates by normalized link', () => {
  const store = db.open(':memory:');
  assert.strictEqual(store.saveArticles([art(1), art(2)]), 2);
  assert.strictEqual(store.saveArticles([art(1, 'S', { link: 'https://X.com/p/1/?utm=a#frag' })]), 0);
  store.close();
});

test('database summary/sent lifecycle', () => {
  const store = db.open(':memory:');
  store.saveArticles([art(1)]);
  const [a] = store.getUnsummarized(10);
  store.saveSummary(a.id, { headline: 'h', anecdote: 'c', insight: 'i', takeaways: ['1', '2', '3', '4', '5'] });
  assert.strictEqual(store.getUnsummarized(10).length, 0);
  const [row] = store.getUnsentSummarized();
  assert.strictEqual(row.anecdote, 'c');
  assert.deepStrictEqual(JSON.parse(row.takeaways), ['1', '2', '3', '4', '5']);
  store.markSent([a.id], '2026-10-03');
  assert.strictEqual(store.getUnsentSummarized().length, 0);
  store.close();
});

test('scraper extracts same-site article links only', () => {
  const html = `<article><a href="/blog/how-to-win-at-seo-in-2026">How to win at SEO in 2026 today</a><p>Intro text</p></article>
    <h2><a href="https://other.com/post-long-enough-title-here-ok">External link with a long title here</a></h2>
    <h3><a href="/tag/seo">Tag page with a long enough title yes</a></h3>
    <h3><a href="/blog/short">Short</a></h3>`;
  const res = extractArticles(html, { name: 'T', url: 'https://site.com/blog/', category: 'c' });
  assert.strictEqual(res.length, 1);
  assert.strictEqual(res[0].link, 'https://site.com/blog/how-to-win-at-seo-in-2026');
  assert.strictEqual(res[0].snippet, 'Intro text');
});

const GOOD = { headline: 'H', cerita: 'Bayangin warung kopi.', insight: 'Lakukan X.', takeaways: ['a', 'b', 'c', 'd', 'e'] };

test('parseSummary tolerates code fences and returns 5 takeaways', () => {
  const ok = parseSummary('```json\n' + JSON.stringify({ ...GOOD, takeaways: ['a', 'b', 'c', 'd', 'e', 'f'] }) + '\n```');
  assert.deepStrictEqual(ok, { headline: 'H', anecdote: 'Bayangin warung kopi.', insight: 'Lakukan X.', takeaways: ['a', 'b', 'c', 'd', 'e'] });
});

test('parseSummary rejects bad output', () => {
  assert.throws(() => parseSummary('no json'));
  assert.throws(() => parseSummary('{"headline":"H"}'), /missing field/);
  assert.throws(() => parseSummary(JSON.stringify({ ...GOOD, takeaways: ['a', 'b', 'c'] })), /need 5 takeaways/);
  assert.throws(() => parseSummary(JSON.stringify({ ...GOOD, takeaways: 'nope' })), /need 5 takeaways/);
});

test('summarizeArticle uses the Claude client response', async () => {
  const fake = { messages: { create: async (req) => {
    assert.ok(req.max_tokens >= 1000);
    return { content: [{ type: 'text', text: JSON.stringify(GOOD) }] };
  } } };
  assert.strictEqual((await summarizeArticle(art(1), { anthropic: fake })).headline, 'H');
});

test('curate caps per source, total, and drops stale articles', () => {
  const now = Date.parse('2026-10-03T00:00:00Z');
  const list = [
    ...[1, 2, 3].map((n) => art(n, 'A', { published_at: '2026-10-02T00:00:00Z' })),
    art(4, 'B', { published_at: '2026-10-02T00:00:00Z' }),
    art(5, 'C', { published_at: '2026-09-01T00:00:00Z' }),
  ];
  const picked = curate(list, { max: 8, maxPerSource: 2, maxAgeHours: 48, now });
  assert.deepStrictEqual(picked.map((a) => a.link.slice(-1)), ['1', '2', '4']);
});

test('formatDigest shows anecdote, insight and 5 numbered takeaways', () => {
  const row = { headline: 'H', anecdote: 'Bayangin warung.', insight: 'Lakukan X.', takeaways: JSON.stringify(['a', 'b', 'c', 'd', 'e']), source: 'S', link: 'https://x.com' };
  const msg = formatDigest([row]);
  assert.match(msg, /DAILY DIGITAL MARKETING DIGEST/);
  assert.match(msg, /\*1\. H\*/);
  assert.match(msg, /📖 Bayangin warung\./);
  assert.match(msg, /💡 \*Insight:\* Lakukan X\./);
  assert.strictEqual((msg.match(/^\d\. [a-e]$/gm) || []).length, 5);
});

test('formatDigest tolerates rows summarized in the old format', () => {
  const msg = formatDigest([{ headline: 'H', insight: 'I', action: 'A', source: 'S', link: 'https://x.com' }]);
  assert.match(msg, /\*1\. H\*/);
  assert.doesNotMatch(msg, /Takeaways/);
});

test('chunkMessage keeps one bubble when it fits and never exceeds two', () => {
  const article = (n) => `*${n}. Judul*\n${'x'.repeat(900)}`;
  const header = 'HEADER';
  const short = [header, article(1), article(2)].join('\n\n');
  assert.strictEqual(chunkMessage(short).length, 1);

  const five = [header, ...[1, 2, 3, 4, 5].map(article)].join('\n\n');   // ~4.7k chars, under the limit
  assert.strictEqual(chunkMessage(five).length, 1);

  const big = [header, ...[1, 2, 3, 4, 5].map((n) => article(n) + 'y'.repeat(600))].join('\n\n'); // ~7.5k chars
  const chunks = chunkMessage(big);
  assert.strictEqual(chunks.length, 2);
  assert.ok(chunks[0].startsWith('HEADER'));
  assert.strictEqual(chunks.join('\n\n'), big);                          // nothing lost, cut only between articles
  assert.ok(Math.abs(chunks[0].length - chunks[1].length) < 2000);        // balanced, not 1 giant + 1 tiny

  const huge = [header, ...Array.from({ length: 12 }, (_, i) => article(i + 1))].join('\n\n');
  assert.strictEqual(chunkMessage(huge).length, 2);                        // hard cap
  assert.strictEqual(chunkMessage('solo').length, 1);
});

test('database migrates a pre-existing old-schema table', () => {
  const Database = require('better-sqlite3');
  const os = require('os'); const path = require('path'); const fs = require('fs');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dm-')), 'old.db');
  const old = new Database(file);
  old.exec("CREATE TABLE articles (id INTEGER PRIMARY KEY AUTOINCREMENT, link_hash TEXT NOT NULL UNIQUE, title TEXT NOT NULL, link TEXT NOT NULL, source TEXT NOT NULL, category TEXT, snippet TEXT, published_at TEXT, headline TEXT, insight TEXT, action TEXT, summarized INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))");
  old.close();
  const store = db.open(file);
  store.saveArticles([art(1)]);
  const [a] = store.getUnsummarized(5);
  store.saveSummary(a.id, { headline: 'h', anecdote: 'c', insight: 'i', takeaways: ['1', '2', '3', '4', '5'] });
  assert.strictEqual(store.getUnsentSummarized()[0].anecdote, 'c');
  store.close();
});

test('sendDigest validates the phone number', async () => {
  await assert.rejects(sendDigest('hi', { provider: 'fonnte', phone: '+62 812' }), /international format/);
  await assert.rejects(sendDigest('hi', { provider: 'fonnte' }), /WHATSAPP_PHONE/);
});

const claudeSays = (text) => ({ messages: { create: async () => ({ content: [{ type: 'text', text }] }) } });
const rows = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, title: `Title ${i + 1}`, link: `https://x.com/p/${i + 1}`, source: 'S', snippet: 's' }));

test('parseRanking keeps known unique ids in the model order', () => {
  assert.deepStrictEqual(parseRanking('```json\n{"ids":[3,1,3,99,2]}\n```', [1, 2, 3]), [3, 1, 2]);
  assert.throws(() => parseRanking('{"ids":[99]}', [1]), /no valid ids/);
  assert.throws(() => parseRanking('nope', [1]), /no JSON/);
});

test('rankArticles reorders by relevance and appends omitted candidates', async () => {
  const ranked = await rankArticles(rows(4), { anthropic: claudeSays('{"ids":[3,1]}') });
  assert.deepStrictEqual(ranked.map((a) => a.id), [3, 1, 2, 4]);
});

test('rankArticles falls back to the original order when the call fails', async () => {
  const boom = { messages: { create: async () => { throw new Error('boom'); } } };
  assert.deepStrictEqual((await rankArticles(rows(3), { anthropic: boom })).map((a) => a.id), [1, 2, 3]);
});

test('summarizeUntil stops at the target, skips failures and reuses new-format rows', async () => {
  let calls = 0;
  const anthropic = { messages: { create: async () => {
    calls++;
    if (calls === 1) throw new Error('bad');
    return { content: [{ type: 'text', text: JSON.stringify(GOOD) }] };
  } } };
  const saved = [];
  const base = rows(5);
  const input = [
    base[0],                                   // fails, skipped
    { ...base[1], summarized: 1, takeaways: JSON.stringify(['a', 'b', 'c', 'd', 'e']), headline: 'old' }, // reused
    base[2],                                   // summarized
    base[3],                                   // summarized -> target reached
    base[4],                                   // never touched
  ];
  const picked = await summarizeUntil(input, 3, (row) => saved.push(row.id), { anthropic });
  assert.deepStrictEqual(picked.map((p) => p.id), [2, 3, 4]);
  assert.deepStrictEqual(saved, [3, 4]);
  assert.strictEqual(picked[0].headline, 'old');
  assert.strictEqual(calls, 3);
});

test('summarizeUntil redoes rows summarized in the old format', async () => {
  const anthropic = claudeSays(JSON.stringify(GOOD));
  const old = { ...rows(1)[0], summarized: 1, takeaways: null, insight: 'i', action: 'a' };
  const [picked] = await summarizeUntil([old], 1, () => {}, { anthropic });
  assert.strictEqual(picked.anecdote, GOOD.cerita);
});

test('getUnsent returns newest unsent articles whether or not summarized', () => {
  const store = db.open(':memory:');
  store.saveArticles([art(1, 'S', { publishedAt: '2026-10-01T00:00:00Z' }), art(2, 'S', { publishedAt: '2026-10-02T00:00:00Z' })]);
  const [first] = store.getUnsent(10);
  assert.strictEqual(first.link, 'https://x.com/p/2');
  store.saveSummary(first.id, { headline: 'h', anecdote: 'c', insight: 'i', takeaways: ['1', '2', '3', '4', '5'] });
  assert.strictEqual(store.getUnsent(10).length, 2);
  store.markSent([first.id], '2026-10-03');
  assert.strictEqual(store.getUnsent(10).length, 1);
  store.close();
});

test('sendDigest sends to a group id without a country code, and prefers it over the phone', async () => {
  const axios = require('axios');
  const original = axios.post;
  const sent = [];
  axios.post = async (url, body) => { sent.push({ url, body: Object.fromEntries(body) }); return { data: { status: true } }; };
  try {
    await sendDigest('halo', { provider: 'fonnte', fonnteToken: 't', phone: '628123456789', group: '120363012345678901@g.us' });
    await sendDigest('halo', { provider: 'fonnte', fonnteToken: 't', phone: '628123456789' });
  } finally {
    axios.post = original;
  }
  assert.strictEqual(sent[0].body.target, '120363012345678901@g.us');
  assert.strictEqual(sent[0].body.countryCode, undefined);
  assert.strictEqual(sent[1].body.target, '628123456789');
  assert.strictEqual(sent[1].body.countryCode, '62');
});

test('sendDigest rejects a malformed group id and works with only a group configured', async () => {
  await assert.rejects(sendDigest('hi', { provider: 'fonnte', fonnteToken: 't', group: 'Grup Digest' }), /WHATSAPP_GROUP_ID must look like/);
  const axios = require('axios');
  const original = axios.post;
  axios.post = async () => ({ data: { status: true } });
  try {
    await sendDigest('hi', { provider: 'fonnte', fonnteToken: 't', group: '1234-5678@g.us' }); // no phone needed
  } finally {
    axios.post = original;
  }
});

const test = require('node:test');
const assert = require('node:assert');
const db = require('../src/database');
const { extractArticles } = require('../src/sources/web-scraper');
const { parseSummary, summarizeArticle } = require('../src/summarizer');
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

test('chunkMessage splits only between articles', () => {
  const chunks = chunkMessage(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)].join('\n\n'), 70);
  assert.strictEqual(chunks.length, 2);
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

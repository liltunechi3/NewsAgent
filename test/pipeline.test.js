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
  store.saveSummary(a.id, { headline: 'h', insight: 'i', action: 'a' });
  assert.strictEqual(store.getUnsummarized(10).length, 0);
  assert.strictEqual(store.getUnsentSummarized().length, 1);
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

test('parseSummary tolerates code fences and rejects bad output', () => {
  const ok = parseSummary('```json\n{"headline":"H","insight":"I","action":"A"}\n```');
  assert.deepStrictEqual(ok, { headline: 'H', insight: 'I', action: 'A' });
  assert.throws(() => parseSummary('no json'));
  assert.throws(() => parseSummary('{"headline":"H"}'));
});

test('summarizeArticle uses the Claude client response', async () => {
  const fake = { messages: { create: async () => ({ content: [{ type: 'text', text: '{"headline":"H","insight":"I","action":"A"}' }] }) } };
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

test('formatDigest and chunkMessage', () => {
  const msg = formatDigest([{ headline: 'H', insight: 'I', action: 'A', source: 'S', link: 'https://x.com' }]);
  assert.match(msg, /DAILY DIGITAL MARKETING DIGEST/);
  assert.match(msg, /\*1\. H\*/);
  const chunks = chunkMessage(['a'.repeat(30), 'b'.repeat(30), 'c'.repeat(30)].join('\n\n'), 70);
  assert.strictEqual(chunks.length, 2);
});

test('sendDigest validates the phone number', async () => {
  await assert.rejects(sendDigest('hi', { provider: 'fonnte', phone: '+62 812' }), /international format/);
  await assert.rejects(sendDigest('hi', { provider: 'fonnte' }), /WHATSAPP_PHONE/);
});

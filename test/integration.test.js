const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Stubs must be registered before src/ modules are loaded.
const calls = { rank: 0, summarize: 0 };
class FakeAnthropic {
  constructor() {
    this.messages = {
      create: async (req) => {
        const prompt = req.messages[0].content;
        if (prompt.startsWith('Pilih')) {
          calls.rank++;
          // Prefer the odd-numbered items, best-first.
          const ids = [...prompt.matchAll(/id=(\d+)/g)].map((m) => Number(m[1])).filter((id) => id % 2 === 1);
          return { content: [{ type: 'text', text: JSON.stringify({ ids }) }] };
        }
        calls.summarize++;
        const title = prompt.match(/Judul: (.*)/)[1];
        return { content: [{ type: 'text', text: JSON.stringify({ headline: `H ${title}`, penjelasan: 'Ini yang terjadi. Aturannya berubah.', insight: 'Lakukan X.', takeaways: ['a', 'b', 'c'] }) }] };
      },
    };
  }
}
require.cache[require.resolve('@anthropic-ai/sdk')] = { id: 'x', filename: 'x', loaded: true, exports: FakeAnthropic };

const recent = (h) => new Date(Date.now() - h * 3600 * 1000).toISOString();
const feed = Array.from({ length: 12 }, (_, i) => ({
  title: `Article ${i + 1}`, link: `https://site${i}.com/post-${i + 1}`, source: `Src${i % 6}`, category: 'c', snippet: 'snip', publishedAt: recent(i + 1),
}));
require.cache[require.resolve('../src/sources/rss-fetcher')] = { id: 'r', filename: 'r', loaded: true, exports: { fetchAllRss: async () => feed } };
require.cache[require.resolve('../src/sources/web-scraper')] = { id: 'w', filename: 'w', loaded: true, exports: { scrapeAll: async () => [] } };

test('runDigest ranks, summarizes only the top 5, and marks them sent', async () => {
  const config = require('../src/config');
  config.dbPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dm-int-')), 'int.db');
  config.whatsapp.provider = 'console';
  config.whatsapp.phone = '628123456789';
  const { runDigest } = require('../src/index');

  const out = [];
  const origLog = console.log;
  console.log = (...a) => out.push(a.join(' '));
  let res;
  try { res = await runDigest({ dryRun: false }); } finally { console.log = origLog; }

  assert.strictEqual(res.sent, 5);
  assert.strictEqual(calls.rank, 1);
  assert.strictEqual(calls.summarize, 5);            // only the 5 chosen articles were summarized
  const digest = out.join('\n');
  assert.match(digest, /\*1\. H Article 1 - /);     // odd ids ranked first
  assert.match(digest, /3 Takeaways/);
  assert.match(digest, /\*1\. H Article 1 - \d{1,2} \S+ \d{4}\*/); // release date in the title
  assert.strictEqual((digest.match(/^\*\d\. /gm) || []).length, 5);

  // A second run sends the next 5 (ids not yet sent), never repeating the first batch.
  const second = await runDigest({ dryRun: false });
  assert.ok(second.sent > 0 && second.sent <= 5);
});

const config = require('./config');
const db = require('./database');
const { fetchAllRss } = require('./sources/rss-fetcher');
const { scrapeAll } = require('./sources/web-scraper');
const { summarizeAll } = require('./summarizer');
const { curate, formatDigest, jakartaIsoDate } = require('./formatter');
const { sendDigest } = require('./whatsapp-sender');

/**
 * Full pipeline: fetch -> dedupe/store -> summarize -> curate -> send.
 * Set DRY_RUN=1 to print the digest without sending or marking articles as sent.
 */
async function runDigest({ dryRun = process.env.DRY_RUN === '1' } = {}) {
  const store = db.open(config.dbPath);
  try {
    const [rss, scraped] = await Promise.all([fetchAllRss(config.rssSources), scrapeAll(config.scrapeSources)]);
    const fetched = [...rss, ...scraped];
    const added = store.saveArticles(fetched);
    console.log(`[fetch] ${fetched.length} articles (${rss.length} rss, ${scraped.length} scraped), ${added} new`);

    const pending = store.getUnsummarized(config.maxCandidates);
    const ok = await summarizeAll(pending, (a, s) => store.saveSummary(a.id, s));
    console.log(`[summarize] ${ok}/${pending.length} summarized`);

    const picked = curate(store.getUnsentSummarized());
    if (picked.length === 0) {
      console.log('[digest] nothing to send');
      return { sent: 0 };
    }
    if (picked.length < config.digestMin) console.warn(`[digest] only ${picked.length} articles (target ${config.digestMin}-${config.digestMax})`);

    const message = formatDigest(picked);
    if (dryRun) {
      console.log('[digest] dry run, not sending:\n\n' + message);
      return { sent: 0, dryRun: true, count: picked.length };
    }
    await sendDigest(message);
    store.markSent(picked.map((a) => a.id), jakartaIsoDate());
    console.log(`[digest] sent ${picked.length} articles`);
    return { sent: picked.length };
  } finally {
    store.close();
  }
}

module.exports = { runDigest };

if (require.main === module) {
  runDigest().catch((err) => {
    console.error('Digest failed:', err.message);
    process.exit(1);
  });
}

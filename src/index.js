const config = require('./config');
const db = require('./database');
const { fetchAllRss } = require('./sources/rss-fetcher');
const { scrapeAll } = require('./sources/web-scraper');
const { summarizeUntil } = require('./summarizer');
const { rankArticles } = require('./ranker');
const { curate, filterFresh, formatDigest, jakartaIsoDate } = require('./formatter');
const { sendDigest } = require('./whatsapp-sender');

/**
 * Full pipeline: fetch -> dedupe/store -> rank by relevance -> summarize the top few -> send.
 * Set DRY_RUN=1 to print the digest without sending or marking articles as sent.
 */
async function runDigest({ dryRun = process.env.DRY_RUN === '1' } = {}) {
  const store = db.open(config.dbPath);
  try {
    const [rss, scraped] = await Promise.all([fetchAllRss(config.rssSources), scrapeAll(config.scrapeSources)]);
    const fetched = [...rss, ...scraped];
    const added = store.saveArticles(fetched);
    console.log(`[fetch] ${fetched.length} articles (${rss.length} rss, ${scraped.length} scraped), ${added} new`);

    const pool = filterFresh(store.getUnsent(config.maxCandidates));
    const ranked = await rankArticles(pool, { count: config.digestMax });
    const shortlist = curate(ranked, { max: config.digestMax + config.rankBackups });
    const picked = await summarizeUntil(shortlist, config.digestMax, (a, s) => store.saveSummary(a.id, s));
    console.log(`[digest] ${pool.length} candidates, ${shortlist.length} shortlisted, ${picked.length} ready`);

    if (picked.length === 0) {
      console.log('[digest] nothing to send');
      return { sent: 0 };
    }
    if (picked.length < config.digestMin) console.warn(`[digest] only ${picked.length} articles (target ${config.digestMax})`);

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

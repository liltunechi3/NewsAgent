require('dotenv').config({ quiet: true });

const onVercel = Boolean(process.env.VERCEL);

module.exports = {
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-haiku-4-5',
  timezone: 'Asia/Jakarta',
  // Vercel's filesystem is read-only except /tmp, and /tmp does not persist between invocations.
  dbPath: process.env.DB_PATH || (onVercel ? '/tmp/articles.db' : './data/articles.db'),
  digestMin: Number(process.env.DIGEST_MIN || 5),
  digestMax: Number(process.env.DIGEST_MAX || 5),
  maxPerSource: 2,
  // Ignore articles older than this when building a digest
  maxAgeHours: Number(process.env.MAX_AGE_HOURS || 48),
  // Articles the ranker chooses from, and extra ranked articles kept as backups if a summary fails
  maxCandidates: 30,
  rankBackups: 3,
  whatsapp: {
    phone: process.env.WHATSAPP_PHONE,
    provider: process.env.WHATSAPP_PROVIDER || 'console',
    fonnteToken: process.env.FONNTE_TOKEN,
  },

  rssSources: [
    { name: 'Search Engine Land', url: 'https://searchengineland.com/feed', category: 'SEO' },
    { name: 'Search Engine Journal', url: 'https://www.searchenginejournal.com/feed/', category: 'SEO' },
    { name: 'HubSpot Blog', url: 'https://blog.hubspot.com/marketing/rss.xml', category: 'Marketing' },
    { name: 'Moz Blog', url: 'https://moz.com/posts/rss/blog', category: 'SEO' },
    { name: 'Semrush Blog', url: 'https://www.semrush.com/blog/feed/', category: 'Performance Marketing' },
    // Added to broaden the pool the ranker picks from. Feed URLs follow each site's standard path and
    // are unverified: a feed that fails is logged as "[rss] <name> failed" and skipped, so prune any that do.
    { name: 'Social Media Examiner', url: 'https://www.socialmediaexaminer.com/feed/', category: 'Social Media' },
    { name: 'Content Marketing Institute', url: 'https://contentmarketinginstitute.com/feed/', category: 'Content Marketing' },
    { name: 'Ahrefs Blog', url: 'https://ahrefs.com/blog/feed/', category: 'SEO' },
    { name: 'Neil Patel', url: 'https://neilpatel.com/blog/feed/', category: 'Marketing' },
    { name: 'Sprout Social', url: 'https://sproutsocial.com/insights/feed/', category: 'Social Media' },
    { name: 'WordStream', url: 'https://www.wordstream.com/blog/feed', category: 'Paid Ads' },
  ],

  // Generic scraper: collects article-looking links from each listing page.
  // `selector` can be tuned per site if the heuristic picks up the wrong links.
  scrapeSources: [
    { name: 'BrandLoom', url: 'https://brandloom.ai/blog', category: 'AI in Marketing', selector: 'article a, h2 a, h3 a' },
    { name: 'ALM Corp', url: 'https://almcorp.com/blog/', category: 'Marketing News', selector: 'article a, h2 a, h3 a' },
  ],
};

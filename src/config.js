require('dotenv').config({ quiet: true });

const onVercel = Boolean(process.env.VERCEL);

module.exports = {
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
  timezone: 'Asia/Jakarta',
  // Vercel's filesystem is read-only except /tmp, and /tmp does not persist between invocations.
  dbPath: process.env.DB_PATH || (onVercel ? '/tmp/articles.db' : './data/articles.db'),
  digestMin: Number(process.env.DIGEST_MIN || 5),
  digestMax: Number(process.env.DIGEST_MAX || 8),
  maxPerSource: 2,
  // Ignore articles older than this when building a digest
  maxAgeHours: Number(process.env.MAX_AGE_HOURS || 48),
  maxCandidates: 16,
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
  ],

  // Generic scraper: collects article-looking links from each listing page.
  // `selector` can be tuned per site if the heuristic picks up the wrong links.
  scrapeSources: [
    { name: 'BrandLoom', url: 'https://brandloom.ai/blog', category: 'AI in Marketing', selector: 'article a, h2 a, h3 a' },
    { name: 'Business.com', url: 'https://www.business.com/categories/digital-marketing/', category: 'Digital Marketing', selector: 'article a, h2 a, h3 a' },
    { name: 'ALM Corp', url: 'https://almcorp.com/blog/', category: 'Marketing News', selector: 'article a, h2 a, h3 a' },
    { name: 'Simplilearn', url: 'https://www.simplilearn.com/digital-marketing/articles', category: 'Learning', selector: 'article a, h2 a, h3 a' },
  ],
};

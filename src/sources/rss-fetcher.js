const Parser = require('rss-parser');

const parser = new Parser({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DMNewsAgent/1.0)' },
});

const clean = (s) => (s || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchRss(source, perFeed = 5) {
  const feed = await parser.parseURL(source.url);
  return (feed.items || [])
    .filter((i) => i.title && i.link)
    .slice(0, perFeed)
    .map((i) => ({
      title: clean(i.title),
      link: i.link.trim(),
      source: source.name,
      category: source.category,
      snippet: clean(i.contentSnippet || i['content:encoded'] || i.content || i.summary).slice(0, 1200),
      publishedAt: i.isoDate || (i.pubDate ? new Date(i.pubDate).toISOString() : null),
    }));
}

/** Fetches all feeds; one failing feed never blocks the others. */
async function fetchAllRss(sources, perFeed) {
  const results = await Promise.allSettled(sources.map((s) => fetchRss(s, perFeed)));
  return results.flatMap((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn(`[rss] ${sources[i].name} failed: ${r.reason.message}`);
    return [];
  });
}

module.exports = { fetchRss, fetchAllRss };

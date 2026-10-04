const axios = require('axios');
const cheerio = require('cheerio');
const { fetchRss } = require('./rss-fetcher');

const MIN_TITLE_LEN = 25;
const SKIP_PATH = /\/(tag|tags|category|categories|author|page|about|contact|privacy|terms|login|signup)(\/|$)/i;

/** Pulls article-like links out of listing-page HTML. Exported for offline testing. */
function extractArticles(html, source, perSite = 5) {
  const $ = cheerio.load(html);
  const base = new URL(source.url);
  const seen = new Set();
  const out = [];

  $(source.selector || 'article a, h2 a, h3 a').each((_, el) => {
    if (out.length >= perSite) return false;
    const $a = $(el);
    const title = ($a.text() || $a.attr('title') || '').replace(/\s+/g, ' ').trim();
    const href = $a.attr('href');
    if (!href || title.length < MIN_TITLE_LEN) return;

    let url;
    try { url = new URL(href, base); } catch { return; }
    if (url.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) return;
    if (SKIP_PATH.test(url.pathname) || url.pathname.length < 2) return;
    if (url.pathname.replace(/\/$/, '') === base.pathname.replace(/\/$/, '')) return;
    url.hash = '';
    if (seen.has(url.href)) return;
    seen.add(url.href);

    const snippet = $a.closest('article, li, div').find('p').first().text().replace(/\s+/g, ' ').trim().slice(0, 600);
    out.push({ title, link: url.href, source: source.name, category: source.category, snippet, publishedAt: null });
  });
  return out;
}

/** Finds the RSS/Atom feed a page advertises in <link rel="alternate">, as an absolute URL (or null). */
function discoverFeed(html, pageUrl) {
  const $ = cheerio.load(html);
  const href = $('link[rel="alternate"]')
    .filter((_, el) => /(rss|atom)\+xml/i.test($(el).attr('type') || ''))
    .first()
    .attr('href');
  if (!href) return null;
  try { return new URL(href, pageUrl).href; } catch { return null; }
}

/**
 * Listing pages often advertise a feed, which gives dates and summaries that plain link-scraping cannot.
 * Try the advertised feed first and fall back to scraping the page's links.
 */
async function scrapeSite(source, perSite = 5, deps = {}) {
  const { get = axios.get, rss = fetchRss } = deps;
  const { data } = await get(source.url, {
    timeout: 15000,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DMNewsAgent/1.0)', Accept: 'text/html' },
  });
  const feedUrl = discoverFeed(data, source.url);
  if (feedUrl) {
    try {
      const items = await rss({ ...source, url: feedUrl }, perSite);
      if (items.length > 0) return items;
    } catch (err) {
      console.warn(`[scrape] ${source.name} feed ${feedUrl} failed (${err.message}); scraping links instead`);
    }
  }
  return extractArticles(data, source, perSite);
}

async function scrapeAll(sources, perSite) {
  const results = await Promise.allSettled(sources.map((s) => scrapeSite(s, perSite)));
  return results.flatMap((r, i) => {
    if (r.status === 'fulfilled') return r.value;
    console.warn(`[scrape] ${sources[i].name} failed: ${r.reason.message}`);
    return [];
  });
}

module.exports = { extractArticles, discoverFeed, scrapeSite, scrapeAll };

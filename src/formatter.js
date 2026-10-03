const config = require('./config');

const jakartaDate = (d = new Date()) =>
  new Intl.DateTimeFormat('id-ID', { timeZone: config.timezone, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(d);

/** ISO date (YYYY-MM-DD) in Jakarta time, used to label digest records. */
const jakartaIsoDate = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(d);

const isFresh = (a, maxAgeHours, now) => !a.published_at || Date.parse(a.published_at) >= now - maxAgeHours * 3600 * 1000;

/** Drops articles older than `maxAgeHours` (undated articles are kept). */
function filterFresh(articles, { maxAgeHours = config.maxAgeHours, now = Date.now() } = {}) {
  return articles.filter((a) => isFresh(a, maxAgeHours, now));
}

/** Keeps the given order, drops stale articles, and allows at most `maxPerSource` per source. */
function curate(articles, { max = config.digestMax, maxPerSource = config.maxPerSource, maxAgeHours = config.maxAgeHours, now = Date.now() } = {}) {
  const perSource = {};
  const picked = [];
  for (const a of filterFresh(articles, { maxAgeHours, now })) {
    if (picked.length >= max) break;
    if ((perSource[a.source] || 0) >= maxPerSource) continue;
    perSource[a.source] = (perSource[a.source] || 0) + 1;
    picked.push(a);
  }
  return picked;
}

function parseTakeaways(raw) {
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** "3 Okt 2026" in Jakarta time, or '' when the article has no (valid) release date. */
function releaseDate(iso) {
  const t = Date.parse(iso || '');
  if (Number.isNaN(t)) return '';
  return new Intl.DateTimeFormat('id-ID', { timeZone: config.timezone, day: 'numeric', month: 'short', year: 'numeric' }).format(t);
}

function formatArticle(a, n) {
  const date = releaseDate(a.published_at);
  const lines = [`*${n}. ${a.headline}${date ? ` - ${date}` : ''}*`];
  const explanation = a.explanation || a.anecdote; // `anecdote` is the legacy field
  if (explanation) lines.push(`📖 ${explanation}`);
  lines.push(`💡 *Insight:* ${a.insight}`);
  const takeaways = parseTakeaways(a.takeaways);
  if (takeaways.length) {
    lines.push(`📌 *${takeaways.length} Takeaways:*`, ...takeaways.map((t, i) => `${i + 1}. ${t}`));
  }
  lines.push(`🔗 ${a.source}: ${a.link}`);
  return lines.join('\n');
}

function formatDigest(articles, date = new Date()) {
  const header = `📰 *DAILY DIGITAL MARKETING DIGEST*\n📅 ${jakartaDate(date)}\n────────────────────────────`;
  return [header, ...articles.map((a, i) => formatArticle(a, i + 1))].join('\n\n');
}

/**
 * Splits a digest into WhatsApp bubbles: one if it fits in `singleLimit` characters,
 * otherwise exactly two, cut between articles at the point that balances their sizes.
 * Never returns more than two, so a long digest stays long rather than turning into a stream of messages.
 */
function chunkMessage(text, singleLimit = 5000) {
  const parts = text.split('\n\n');
  if (text.length <= singleLimit || parts.length < 2) return [text];
  let best = null;
  for (let i = 1; i < parts.length; i++) {
    const first = parts.slice(0, i).join('\n\n');
    const second = parts.slice(i).join('\n\n');
    const worst = Math.max(first.length, second.length);
    if (!best || worst < best.worst) best = { worst, chunks: [first, second] };
  }
  return best.chunks;
}

module.exports = { curate, filterFresh, releaseDate, formatDigest, formatArticle, chunkMessage, jakartaDate, jakartaIsoDate };

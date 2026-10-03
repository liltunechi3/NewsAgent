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

function formatArticle(a, n) {
  const lines = [`*${n}. ${a.headline}*`];
  if (a.anecdote) lines.push(`📖 ${a.anecdote}`);
  lines.push(`💡 *Insight:* ${a.insight}`);
  const takeaways = parseTakeaways(a.takeaways);
  if (takeaways.length) {
    lines.push('📌 *5 Takeaways:*', ...takeaways.map((t, i) => `${i + 1}. ${t}`));
  }
  lines.push(`🗞️ Sumber: ${a.source}`, `🔗 ${a.link}`);
  return lines.join('\n');
}

function formatDigest(articles, date = new Date()) {
  const header = `📰 *DAILY DIGITAL MARKETING DIGEST*\n📅 ${jakartaDate(date)}\n────────────────────────────`;
  return [header, ...articles.map((a, i) => formatArticle(a, i + 1))].join('\n\n');
}

/** Splits a message into chunks below `limit`, breaking only between articles. */
function chunkMessage(text, limit = 3500) {
  const parts = text.split('\n\n');
  const chunks = [];
  let cur = '';
  for (const p of parts) {
    if (cur && (cur + '\n\n' + p).length > limit) {
      chunks.push(cur);
      cur = p;
    } else {
      cur = cur ? cur + '\n\n' + p : p;
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

module.exports = { curate, filterFresh, formatDigest, formatArticle, chunkMessage, jakartaDate, jakartaIsoDate };

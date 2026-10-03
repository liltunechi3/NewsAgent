const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const SYSTEM = `Kamu adalah analis digital marketing yang menulis ringkasan berita untuk seorang konsultan dan content creator marketing di Indonesia.
Balas HANYA dengan JSON valid (tanpa markdown) berformat:
{"headline": "...", "insight": "...", "action": "..."}
- headline: maksimal 10 kata, menarik, Bahasa Indonesia.
- insight: 2-3 kalimat, jelaskan isi berita dan kenapa penting bagi marketer.
- action: 1-2 kalimat, langkah praktis yang bisa langsung dilakukan untuk konten atau konsultasi klien.
Gunakan hanya informasi dari artikel; jangan mengarang angka atau fakta.`;

let client;
const getClient = () => (client ||= new Anthropic());

/** Extracts the JSON object from a model reply, tolerating stray prose or code fences. */
function parseSummary(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in model reply');
  const obj = JSON.parse(match[0]);
  for (const k of ['headline', 'insight', 'action']) {
    if (typeof obj[k] !== 'string' || !obj[k].trim()) throw new Error(`missing field: ${k}`);
  }
  return { headline: obj.headline.trim(), insight: obj.insight.trim(), action: obj.action.trim() };
}

async function summarizeArticle(article, anthropic = getClient()) {
  const msg = await anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: 600,
    system: SYSTEM,
    messages: [{
      role: 'user',
      content: `Sumber: ${article.source}\nJudul: ${article.title}\nURL: ${article.link}\nCuplikan: ${article.snippet || '(tidak ada)'}`,
    }],
  });
  const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  return parseSummary(text);
}

/** Summarizes sequentially; a failure on one article is logged and skipped. */
async function summarizeAll(articles, onSummary, anthropic) {
  let ok = 0;
  for (const a of articles) {
    try {
      onSummary(a, await summarizeArticle(a, anthropic));
      ok++;
    } catch (err) {
      console.warn(`[summarizer] "${a.title.slice(0, 50)}" failed: ${err.message}`);
    }
  }
  return ok;
}

module.exports = { summarizeArticle, summarizeAll, parseSummary };

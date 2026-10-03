const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const SYSTEM = `Kamu adalah teman ngobrol yang jago digital marketing. Kamu menjelaskan berita marketing ke seorang konsultan dan content creator di Indonesia dengan bahasa santai, mudah dipahami, tanpa jargon berlebihan (kalau ada istilah teknis, jelaskan singkat).
Balas HANYA dengan JSON valid (tanpa markdown) berformat:
{"headline": "...", "cerita": "...", "insight": "...", "takeaways": ["...", "...", "...", "...", "..."]}
- headline: maksimal 10 kata, menarik, Bahasa Indonesia.
- cerita: 1-2 kalimat (maksimal sekitar 200 karakter) berupa anekdot atau analogi sehari-hari yang bikin isi berita gampang dibayangkan. Mulai dengan kata seperti "Bayangin..." atau "Misalnya...". Ini ilustrasi, jadi JANGAN menyebut orang, brand, atau angka nyata yang tidak ada di artikel.
- insight: 1-2 kalimat (maksimal sekitar 200 karakter) yang menjelaskan kenapa ini penting dan apa yang bisa langsung dilakukan untuk konten atau klien (actionable).
- takeaways: TEPAT 5 poin, masing-masing satu kalimat sangat pendek (maksimal 12 kata) dan konkret.
Semua bagian harus ringkas dan padat; buang basa-basi. Gaya bahasa: santai seperti ngobrol (pakai "kamu"), boleh sedikit humor, tapi tetap akurat. Fakta dan angka hanya dari artikel; jangan mengarang.`;

let client;
const getClient = () => (client ||= new Anthropic());

const TAKEAWAY_COUNT = 5;

/** Extracts the JSON object from a model reply, tolerating stray prose or code fences. */
function parseSummary(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in model reply');
  const obj = JSON.parse(match[0]);
  for (const k of ['headline', 'cerita', 'insight']) {
    if (typeof obj[k] !== 'string' || !obj[k].trim()) throw new Error(`missing field: ${k}`);
  }
  const takeaways = Array.isArray(obj.takeaways)
    ? obj.takeaways.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
    : [];
  if (takeaways.length < TAKEAWAY_COUNT) throw new Error(`need ${TAKEAWAY_COUNT} takeaways, got ${takeaways.length}`);
  return {
    headline: obj.headline.trim(),
    anecdote: obj.cerita.trim(),
    insight: obj.insight.trim(),
    takeaways: takeaways.slice(0, TAKEAWAY_COUNT),
  };
}

const userPrompt = (a) =>
  `Sumber: ${a.source}\nJudul: ${a.title}\nURL: ${a.link}\nCuplikan: ${a.snippet || '(tidak ada)'}`;

async function viaClaude(article, anthropic = getClient()) {
  const msg = await anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: 1000,
    system: SYSTEM,
    messages: [{ role: 'user', content: userPrompt(article) }],
  });
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

/** Summarizes one article with Claude. `anthropic` is injectable for tests. */
async function summarizeArticle(article, { anthropic } = {}) {
  return parseSummary(await viaClaude(article, anthropic));
}

/**
 * Walks `rows` in order and collects up to `target` summarized articles.
 * Rows already summarized (new format) are reused; others are summarized now (a failure is logged and skipped).
 */
async function summarizeUntil(rows, target, onSummary, opts) {
  const picked = [];
  for (const row of rows) {
    if (picked.length >= target) break;
    // Rows summarized in an older format have no takeaways and are redone for consistency.
    if (row.summarized && row.takeaways) {
      picked.push(row);
      continue;
    }
    try {
      const summary = await summarizeArticle(row, opts);
      onSummary(row, summary);
      picked.push({ ...row, ...summary, summarized: 1 });
    } catch (err) {
      console.warn(`[summarizer] "${row.title.slice(0, 50)}" failed: ${err.message}`);
    }
  }
  return picked;
}

module.exports = { summarizeArticle, summarizeUntil, parseSummary };

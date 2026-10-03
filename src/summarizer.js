const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const SYSTEM = `Kamu adalah teman ngobrol yang jago digital marketing. Kamu menjelaskan berita marketing ke seorang konsultan dan content creator di Indonesia dengan bahasa umum yang santai dan mudah dipahami orang awam, tanpa jargon berlebihan (kalau ada istilah teknis, jelaskan singkat).
Balas HANYA dengan JSON valid (tanpa markdown) berformat:
{"headline": "...", "penjelasan": "...", "insight": "...", "takeaways": ["...", "...", "..."]}
- headline: maksimal 10 kata, menarik, Bahasa Indonesia.
- penjelasan: 3-4 kalimat (maksimal sekitar 400 karakter). Mulai dengan menjelaskan apa yang terjadi dan kenapa orang membahasnya, pakai bahasa umum yang gampang dipahami. Lalu tutup dengan satu anekdot atau analogi singkat sehari-hari ("Bayangin..." atau "Misalnya...") supaya mudah dibayangkan. Jadi isinya penjelasan DAN anekdot, bukan anekdot saja. Anekdot hanya ilustrasi: JANGAN menyebut orang, brand, atau angka nyata yang tidak ada di artikel.
- insight: 1-2 kalimat (maksimal sekitar 200 karakter) yang menjelaskan kenapa ini penting dan apa yang bisa langsung dilakukan untuk konten atau klien (actionable).
- takeaways: TEPAT 3 poin, rangkuman paling penting dari artikel, masing-masing satu kalimat pendek (maksimal 14 kata) dan konkret.
Gaya bahasa: santai seperti ngobrol (pakai "kamu"), boleh sedikit humor, tapi tetap akurat dan padat; buang basa-basi. Fakta dan angka hanya dari artikel; jangan mengarang.`;

let client;
const getClient = () => (client ||= new Anthropic());

const TAKEAWAY_COUNT = 3;

/** Extracts the JSON object from a model reply, tolerating stray prose or code fences. */
function parseSummary(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in model reply');
  const obj = JSON.parse(match[0]);
  for (const k of ['headline', 'penjelasan', 'insight']) {
    if (typeof obj[k] !== 'string' || !obj[k].trim()) throw new Error(`missing field: ${k}`);
  }
  const takeaways = Array.isArray(obj.takeaways)
    ? obj.takeaways.filter((t) => typeof t === 'string' && t.trim()).map((t) => t.trim())
    : [];
  if (takeaways.length < TAKEAWAY_COUNT) throw new Error(`need ${TAKEAWAY_COUNT} takeaways, got ${takeaways.length}`);
  return {
    headline: obj.headline.trim(),
    explanation: obj.penjelasan.trim(),
    insight: obj.insight.trim(),
    takeaways: takeaways.slice(0, TAKEAWAY_COUNT),
  };
}

const userPrompt = (a) =>
  `Sumber: ${a.source}\nJudul: ${a.title}\nURL: ${a.link}\nCuplikan: ${a.snippet || '(tidak ada)'}`;

async function viaClaude(article, anthropic = getClient()) {
  const msg = await anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: 1200,
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
    // Rows summarized in an older format (no explanation field) are redone for consistency.
    if (row.summarized && row.explanation && row.takeaways) {
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

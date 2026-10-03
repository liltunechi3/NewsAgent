const Anthropic = require('@anthropic-ai/sdk');
const config = require('./config');

const SYSTEM = `Kamu adalah editor yang memilih berita untuk seorang konsultan dan content creator digital marketing di Indonesia.
Dari daftar artikel, pilih yang PALING relevan dan berguna untuk praktisi digital marketing: SEO, iklan berbayar, social media, content marketing, email/CRM, analytics, AI untuk marketing, e-commerce marketing, dan perubahan platform/algoritma yang berdampak langsung ke pekerjaan marketer.
Prioritaskan yang bisa langsung ditindaklanjuti dan yang baru. Turunkan prioritas: promosi event/konferensi, lowongan kerja, pengumuman produk vendor tanpa pelajaran umum, dan artikel yang hanya tipis atau basa-basi.
Pilih juga dengan variasi topik, jangan semuanya soal hal yang sama.
Balas HANYA dengan JSON valid (tanpa markdown): {"ids": [<id>, <id>, ...]} berisi id artikel, dari yang paling relevan ke yang kurang relevan.`;

let client;
const getClient = () => (client ||= new Anthropic());

/** Parses {"ids": [...]} from a model reply, keeping only known, unique ids in the model's order. */
function parseRanking(text, validIds) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('no JSON in ranking reply');
  const ids = JSON.parse(match[0]).ids;
  if (!Array.isArray(ids)) throw new Error('ranking reply has no ids array');
  const valid = new Set(validIds);
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    if (valid.has(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  if (out.length === 0) throw new Error('ranking reply had no valid ids');
  return out;
}

/**
 * Asks Claude (one cheap call) which candidates are most relevant to digital marketing.
 * Returns the candidates reordered best-first; candidates the model omitted follow in their original order.
 * Falls back to the original order if the call or its output fails.
 */
async function rankArticles(candidates, { count = config.digestMax, anthropic } = {}) {
  if (candidates.length <= 1) return candidates;
  const listing = candidates
    .map((a) => `id=${a.id} | ${a.source} | ${a.title} | ${(a.snippet || '').slice(0, 160)}`)
    .join('\n');
  try {
    const msg = await (anthropic || getClient()).messages.create({
      model: config.anthropicModel,
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: 'user', content: `Pilih ${count + 3} artikel paling relevan dari daftar ini:\n\n${listing}` }],
    });
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const order = parseRanking(text, candidates.map((a) => a.id));
    const byId = new Map(candidates.map((a) => [a.id, a]));
    const ranked = order.map((id) => byId.get(id));
    return [...ranked, ...candidates.filter((a) => !order.includes(a.id))];
  } catch (err) {
    console.warn(`[ranker] failed, using original order: ${err.message}`);
    return candidates;
  }
}

module.exports = { rankArticles, parseRanking };

const axios = require('axios');
const config = require('./config');
const { chunkMessage } = require('./formatter');

const GROUP_ID = /^[\w-]+@g\.us$/;

/** Group id (WHATSAPP_GROUP_ID) wins over the personal number; returns the send target and its kind. */
function resolveTarget(wa) {
  if (wa.group) {
    if (!GROUP_ID.test(wa.group)) throw new Error('WHATSAPP_GROUP_ID must look like 1234567890-1234567890@g.us');
    return { target: wa.group, isGroup: true };
  }
  if (!wa.phone) throw new Error('WHATSAPP_PHONE (or WHATSAPP_GROUP_ID) is not set');
  if (!/^\d{8,15}$/.test(wa.phone)) throw new Error('WHATSAPP_PHONE must be digits only, international format (e.g. 62812345678)');
  return { target: wa.phone, isGroup: false };
}

async function sendFonnte(text, { target, isGroup }, { fonnteToken }) {
  if (!fonnteToken) throw new Error('FONNTE_TOKEN is not set');
  for (const chunk of chunkMessage(text)) {
    const fields = { target, message: chunk };
    if (!isGroup) fields.countryCode = '62';
    const body = new URLSearchParams(fields);
    const { data } = await axios.post('https://api.fonnte.com/send', body, {
      headers: { Authorization: fonnteToken },
      timeout: 20000,
    });
    if (data && data.status === false) throw new Error(`Fonnte error: ${data.reason || JSON.stringify(data)}`);
  }
}

/** Local/VPS only: drives WhatsApp Web. First run prints a QR code to scan. */
async function sendWwebjs(text, { target, isGroup }) {
  let Client, LocalAuth, qrcode;
  try {
    ({ Client, LocalAuth } = require('whatsapp-web.js'));
    qrcode = require('qrcode-terminal');
  } catch {
    throw new Error('whatsapp-web.js is not installed (run: npm install whatsapp-web.js qrcode-terminal)');
  }
  const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] },
  });
  client.on('qr', (qr) => {
    console.log('Scan this QR code with WhatsApp (Linked devices):');
    qrcode.generate(qr, { small: true });
  });
  const ready = new Promise((resolve, reject) => {
    client.once('ready', resolve);
    client.once('auth_failure', reject);
  });
  await client.initialize();
  try {
    await ready;
    const chatId = isGroup ? target : `${target}@c.us`;
    for (const chunk of chunkMessage(text)) await client.sendMessage(chatId, chunk);
  } finally {
    await client.destroy();
  }
}

async function sendDigest(text, wa = config.whatsapp) {
  if (wa.provider === 'console') {
    console.log('\n' + text + '\n');
    return;
  }
  const target = resolveTarget(wa);
  if (wa.provider === 'fonnte') return sendFonnte(text, target, wa);
  if (wa.provider === 'wwebjs') {
    if (process.env.VERCEL) throw new Error('wwebjs cannot run on Vercel; use WHATSAPP_PROVIDER=fonnte');
    return sendWwebjs(text, target);
  }
  throw new Error(`Unknown WHATSAPP_PROVIDER: ${wa.provider}`);
}

module.exports = { sendDigest };

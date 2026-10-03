const axios = require('axios');
const config = require('./config');
const { chunkMessage } = require('./formatter');

async function sendFonnte(text, { phone, fonnteToken }) {
  if (!fonnteToken) throw new Error('FONNTE_TOKEN is not set');
  for (const chunk of chunkMessage(text)) {
    const body = new URLSearchParams({ target: phone, message: chunk, countryCode: '62' });
    const { data } = await axios.post('https://api.fonnte.com/send', body, {
      headers: { Authorization: fonnteToken },
      timeout: 20000,
    });
    if (data && data.status === false) throw new Error(`Fonnte error: ${data.reason || JSON.stringify(data)}`);
  }
}

/** Local/VPS only: drives WhatsApp Web. First run prints a QR code to scan. */
async function sendWwebjs(text, { phone }) {
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
    const chatId = `${phone}@c.us`;
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
  if (!wa.phone) throw new Error('WHATSAPP_PHONE is not set');
  if (!/^\d{8,15}$/.test(wa.phone)) throw new Error('WHATSAPP_PHONE must be digits only, international format (e.g. 62812345678)');
  if (wa.provider === 'fonnte') return sendFonnte(text, wa);
  if (wa.provider === 'wwebjs') {
    if (process.env.VERCEL) throw new Error('wwebjs cannot run on Vercel; use WHATSAPP_PROVIDER=fonnte');
    return sendWwebjs(text, wa);
  }
  throw new Error(`Unknown WHATSAPP_PROVIDER: ${wa.provider}`);
}

module.exports = { sendDigest };

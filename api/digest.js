const { runDigest } = require('../src/index');

// Invoked by the Vercel cron in vercel.json. Vercel sends "Authorization: Bearer $CRON_SECRET".
module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  try {
    res.status(200).json(await runDigest());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

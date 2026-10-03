# DM News Agent

Daily digital marketing news digest, in Bahasa Indonesia, delivered to WhatsApp at 10:00 Jakarta time.

**Pipeline:** fetch (11 RSS feeds + 2 scraped sites) → dedupe in SQLite → Claude picks the 5 most relevant to digital marketing (one cheap call over up to 20 candidates) → only those 5 are summarized → send via WhatsApp.

## Quick start

```bash
npm install
cp .env.example .env     # fill in ANTHROPIC_API_KEY, WHATSAPP_PHONE, provider settings
npm test                 # offline unit tests
npm run dry-run          # runs the whole pipeline, prints the digest, sends nothing
npm start                # real run
```

## Summaries (Claude)

Each article is rewritten in casual, easy-to-follow Bahasa Indonesia: a headline, a short anecdote/analogy (marked as an illustration, no invented facts), an actionable insight, and exactly 5 takeaways. Edit the `SYSTEM` prompt in `src/summarizer.js` to change tone or structure. A digest has 5 articles (change with `DIGEST_MAX`); ranking prompt lives in `src/ranker.js` and favors SEO, ads, social, content, email/CRM, analytics and AI-for-marketing, and down-ranks event promos, job posts and thin vendor announcements. If a chosen article fails to summarize, the next-ranked one takes its place. Cost is roughly $0.025 per digest (about 200 digests per $5 on Haiku).

Summaries use Claude via the Anthropic API. The default model is `claude-haiku-4-5` (cheapest; roughly $1/month at ~16 articles/day). Override it with `ANTHROPIC_MODEL`. Larger models cost more and think before answering, which can need a higher `max_tokens` in `src/summarizer.js`.

## WhatsApp providers (`WHATSAPP_PROVIDER`)

| Provider | Where it works | Notes |
|---|---|---|
| `fonnte` | Anywhere, including Vercel | Hosted WhatsApp API ([fonnte.com](https://fonnte.com)). Set `FONNTE_TOKEN`. |
| `wwebjs` | Local machine / VPS only | Automates WhatsApp Web via `whatsapp-web.js`. Scan the QR code on first run; the session is kept in `.wwebjs_auth/`. |
| `console` | Anywhere | Prints the digest. Useful for testing. |

`WHATSAPP_PHONE` is digits only, international format (e.g. `62812345678`).

## Scheduling

- **Vercel:** `vercel.json` registers a cron at `0 3 * * *` UTC (= 10:00 Jakarta) calling `/api/digest`. Set `ANTHROPIC_API_KEY`, `WHATSAPP_PHONE`, `WHATSAPP_PROVIDER=fonnte`, `FONNTE_TOKEN` and `CRON_SECRET` in the project's environment variables; Vercel sends `CRON_SECRET` as a bearer token and the endpoint rejects anything else.
- **Cron on a machine/VPS:** `0 3 * * * cd /path/to/newsagent && npm start` (server in UTC), or use `CRON_TZ=Asia/Jakarta` with `0 10 * * *`.
- **Windows:** Task Scheduler, daily 10:00, `node src/index.js`.

### Vercel limitation: no persistent dedup

Vercel's filesystem is ephemeral, so on Vercel the SQLite file lives in `/tmp` and is lost between invocations. Dedup then relies on the `MAX_AGE_HOURS` freshness filter (RSS items carry dates; scraped items don't, so they may repeat on consecutive days). For true cross-day dedup, run on a machine/VPS with a persistent disk, or swap `src/database.js` for a hosted database (e.g. Supabase).

## Configuration

Sources live in `src/config.js`. Scraped sites use a generic link extractor (`selector` per site); if a site's layout changes or picks up the wrong links, adjust its `selector`. The scraper URLs were written from the project docs and have not been verified against the live sites.

Optional env vars: `ANTHROPIC_MODEL`, `DB_PATH`, `DIGEST_MIN`, `DIGEST_MAX`, `MAX_AGE_HOURS`, `DRY_RUN=1`.

## Layout

```
src/index.js            pipeline orchestrator (runDigest)
src/config.js           sources and settings
src/database.js         SQLite store + dedup
src/sources/            rss-fetcher.js, web-scraper.js
src/summarizer.js       Claude summaries
src/formatter.js        curation + WhatsApp formatting
src/whatsapp-sender.js  fonnte / wwebjs / console delivery
api/digest.js           Vercel cron endpoint
test/                   offline unit tests
```

## Troubleshooting

- **No articles:** run `npm run dry-run` and check the `[rss]` / `[scrape]` warnings; a failing source never blocks the others.
- **Summaries failing:** check `ANTHROPIC_API_KEY`; failures are logged per article.
- **Nothing arrives:** check the phone format and provider credentials; run with `WHATSAPP_PROVIDER=console` to verify the digest itself.

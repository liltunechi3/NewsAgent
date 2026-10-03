const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const hashLink = (link) => crypto.createHash('md5').update(normalizeLink(link)).digest('hex');

function normalizeLink(link) {
  try {
    const u = new URL(link);
    u.hash = '';
    u.search = '';
    return u.toString().replace(/\/$/, '').toLowerCase();
  } catch {
    return String(link).trim().toLowerCase();
  }
}

function open(dbPath) {
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      link_hash TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      link TEXT NOT NULL,
      source TEXT NOT NULL,
      category TEXT,
      snippet TEXT,
      published_at TEXT,
      headline TEXT,
      insight TEXT,
      action TEXT,
      summarized INTEGER NOT NULL DEFAULT 0,
      sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS digests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      digest_date TEXT NOT NULL,
      article_count INTEGER NOT NULL,
      sent_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO articles (link_hash, title, link, source, category, snippet, published_at)
    VALUES (@link_hash, @title, @link, @source, @category, @snippet, @published_at)
  `);

  return {
    raw: db,
    /** Inserts articles, skipping duplicates. Returns how many were new. */
    saveArticles(articles) {
      let added = 0;
      db.transaction((items) => {
        for (const a of items) {
          const res = insert.run({
            link_hash: hashLink(a.link),
            title: a.title,
            link: a.link,
            source: a.source,
            category: a.category || null,
            snippet: a.snippet || null,
            published_at: a.publishedAt || null,
          });
          added += res.changes;
        }
      })(articles);
      return added;
    },
    getUnsummarized(limit) {
      return db.prepare('SELECT * FROM articles WHERE summarized = 0 AND sent = 0 ORDER BY id DESC LIMIT ?').all(limit);
    },
    saveSummary(id, { headline, insight, action }) {
      db.prepare('UPDATE articles SET headline=?, insight=?, action=?, summarized=1 WHERE id=?').run(headline, insight, action, id);
    },
    getUnsentSummarized() {
      return db.prepare('SELECT * FROM articles WHERE summarized = 1 AND sent = 0 ORDER BY COALESCE(published_at, created_at) DESC').all();
    },
    markSent(ids, digestDate) {
      db.transaction(() => {
        const upd = db.prepare('UPDATE articles SET sent = 1 WHERE id = ?');
        for (const id of ids) upd.run(id);
        db.prepare('INSERT INTO digests (digest_date, article_count) VALUES (?, ?)').run(digestDate, ids.length);
      })();
    },
    close: () => db.close(),
  };
}

module.exports = { open, hashLink, normalizeLink };

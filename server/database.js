const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function createDatabase(filename = ":memory:") {
  if (filename !== ":memory:") {
    fs.mkdirSync(path.dirname(filename), { recursive: true });
  }

  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      email TEXT,
      auth_provider TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      avatar_url TEXT,
      bio TEXT,
      preferred_locale TEXT NOT NULL DEFAULT 'zh-CN',
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(auth_provider, provider_user_id)
    );
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      author_id TEXT NOT NULL REFERENCES users(id),
      title TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL DEFAULT '',
      markdown_content TEXT NOT NULL DEFAULT '',
      cover_image_url TEXT,
      style_preset TEXT NOT NULL DEFAULT 'social',
      status TEXT NOT NULL DEFAULT 'draft',
      visibility TEXT NOT NULL DEFAULT 'public',
      tags TEXT NOT NULL DEFAULT '[]',
      category TEXT NOT NULL DEFAULT 'General',
      view_count INTEGER NOT NULL DEFAULT 0,
      published_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      parent_id TEXT REFERENCES comments(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS likes (
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL,
      PRIMARY KEY(article_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS shares (
      id TEXT PRIMARY KEY,
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      user_id TEXT REFERENCES users(id),
      platform TEXT NOT NULL,
      share_url TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS assets (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL REFERENCES users(id),
      article_id TEXT NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
      original_filename TEXT NOT NULL,
      source_path TEXT,
      storage_key TEXT NOT NULL UNIQUE,
      public_url TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      action TEXT NOT NULL,
      before_value TEXT,
      after_value TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_articles_public
      ON articles(status, visibility, published_at DESC);
    CREATE INDEX IF NOT EXISTS idx_articles_author_updated
      ON articles(author_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_comments_article_status
      ON comments(article_id, status, created_at);
    CREATE INDEX IF NOT EXISTS idx_likes_article
      ON likes(article_id);
    CREATE INDEX IF NOT EXISTS idx_shares_article
      ON shares(article_id);
    CREATE INDEX IF NOT EXISTS idx_assets_article_status
      ON assets(article_id, status, created_at DESC);
  `);

  const articleColumns = db.prepare("PRAGMA table_info(articles)").all().map((column) => column.name);
  if (!articleColumns.includes("style_preset")) {
    db.exec("ALTER TABLE articles ADD COLUMN style_preset TEXT NOT NULL DEFAULT 'social'");
  }
  return db;
}

function articleProjection(options = {}) {
  const content = options.includeContent === false
    ? ""
    : "a.markdown_content,";
  return `
    SELECT a.id, a.author_id, a.title, a.slug, a.summary, ${content}
      a.cover_image_url, a.style_preset, a.status, a.visibility, a.tags, a.category,
      a.view_count, a.published_at, a.created_at, a.updated_at,
      u.username AS author_name,
      (SELECT COUNT(*) FROM likes l WHERE l.article_id = a.id) AS like_count,
      (SELECT COUNT(*) FROM comments c WHERE c.article_id = a.id AND c.status = 'active') AS comment_count,
      (SELECT COUNT(*) FROM shares s WHERE s.article_id = a.id) AS share_count
    FROM articles a
    JOIN users u ON u.id = a.author_id
  `;
}

function serializeArticle(row) {
  if (!row) return null;
  return {
    ...row,
    tags: JSON.parse(row.tags || "[]")
  };
}

module.exports = { articleProjection, createDatabase, serializeArticle };

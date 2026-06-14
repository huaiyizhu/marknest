const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { articleProjection, serializeArticle } = require("./database");
const { currentUser, requireAdmin, requireUser } = require("./auth");

const root = path.resolve(__dirname, "..");

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("Invalid JSON body");
    error.status = 400;
    throw error;
  }
}

function slugify(value) {
  const slug = String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "");
  return slug || `article-${Date.now()}`;
}

function uniqueSlug(db, title, currentId) {
  const base = slugify(title);
  let slug = base;
  let index = 2;
  while (db.prepare("SELECT id FROM articles WHERE slug = ? AND id != ?").get(slug, currentId || "")) {
    slug = `${base}-${index++}`;
  }
  return slug;
}

function parseMarkdownUpload(markdown) {
  const text = String(markdown || "");
  const result = { attributes: {}, body: text };
  if (text.startsWith("---")) {
    const end = text.indexOf("\n---", 3);
    if (end !== -1) {
      for (const line of text.slice(3, end).trim().split("\n")) {
        const separator = line.indexOf(":");
        if (separator > -1) result.attributes[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
      }
      result.body = text.slice(end + 4).trimStart();
    }
  }
  const heading = result.body.match(/^#\s+(.+)$/m);
  return {
    title: result.attributes.title || heading?.[1] || "Untitled",
    summary: result.attributes.summary || result.attributes.description || "",
    category: result.attributes.category || "General",
    tags: String(result.attributes.tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
    markdown_content: result.body
  };
}

function getArticle(db, id) {
  return serializeArticle(db.prepare(`${articleProjection()} WHERE a.id = ?`).get(id));
}

function publicArticle(row) {
  if (!row) return row;
  return {
    ...row,
    markdown_content: row.markdown_content
  };
}

function canManage(user, article) {
  return user && (user.role === "admin" || user.id === article.author_id);
}

function audit(db, actor, targetType, targetId, action, beforeValue, afterValue) {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, target_type, target_id, action, before_value, after_value, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    crypto.randomUUID(),
    actor.id,
    targetType,
    targetId,
    action,
    beforeValue == null ? null : JSON.stringify(beforeValue),
    afterValue == null ? null : JSON.stringify(afterValue),
    new Date().toISOString()
  );
}

function staticFile(req, res, pathname) {
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filename = path.resolve(root, requested);
  if (!filename.startsWith(root) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) return false;
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".md": "text/markdown" };
  res.writeHead(200, { "content-type": `${types[path.extname(filename)] || "application/octet-stream"}; charset=utf-8` });
  fs.createReadStream(filename).pipe(res);
  return true;
}

function createApp(db) {
  return async function app(req, res) {
    const url = new URL(req.url, "http://localhost");
    const pathname = url.pathname;
    const method = req.method;

    try {
      if (pathname === "/api/health") return json(res, 200, { status: "ok" });
      if (pathname === "/api/auth/providers") {
        const production = process.env.NODE_ENV === "production";
        const providers = [];
        if (!production || process.env.MICROSOFT_AUTH_CLIENT_ID) {
          providers.push({ id: "microsoft", loginUrl: "/.auth/login/aad?post_login_redirect_uri=/" });
        }
        if (!production || process.env.GOOGLE_AUTH_CLIENT_ID) {
          providers.push({ id: "google", loginUrl: "/.auth/login/google?post_login_redirect_uri=/" });
        }
        return json(res, 200, {
          providers
        });
      }
      if (pathname === "/api/auth/me" && method === "GET") {
        const user = currentUser(req, db);
        return json(res, 200, { authenticated: Boolean(user), user });
      }
      if (pathname === "/api/auth/logout" && method === "POST") return json(res, 200, { logoutUrl: "/.auth/logout?post_logout_redirect_uri=/" });

      if (pathname === "/api/users/me/locale" && method === "PUT") {
        const user = requireUser(req, db);
        const body = await readJson(req);
        if (!["zh-CN", "en-US"].includes(body.locale)) return json(res, 400, { error: "Unsupported locale" });
        db.prepare("UPDATE users SET preferred_locale = ?, updated_at = ? WHERE id = ?").run(body.locale, new Date().toISOString(), user.id);
        return json(res, 200, { locale: body.locale });
      }

      if (pathname === "/api/articles" && method === "GET") {
        const user = currentUser(req, db);
        const mine = url.searchParams.get("mine") === "true";
        const rows = mine && user
          ? db.prepare(`${articleProjection()} WHERE a.author_id = ? ORDER BY a.updated_at DESC`).all(user.id)
          : db.prepare(`${articleProjection()} WHERE a.status = 'published' AND a.visibility = 'public' ORDER BY a.published_at DESC`).all();
        return json(res, 200, { articles: rows.map(serializeArticle) });
      }

      if (pathname === "/api/articles" && method === "POST") {
        const user = requireUser(req, db);
        const body = await readJson(req);
        if (!body.title?.trim()) return json(res, 400, { error: "Title is required" });
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO articles
           (id, author_id, title, slug, summary, markdown_content, cover_image_url, status, visibility, tags, category, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, user.id, body.title.trim(), uniqueSlug(db, body.title), body.summary || "", body.markdown_content || "",
          body.cover_image_url || null, body.status || "draft", body.visibility || "public", JSON.stringify(body.tags || []),
          body.category || "General", now, now);
        return json(res, 201, { article: getArticle(db, id) });
      }

      if (pathname === "/api/articles/upload-md" && method === "POST") {
        const user = requireUser(req, db);
        const body = await readJson(req);
        const parsed = parseMarkdownUpload(body.markdown);
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO articles
           (id, author_id, title, slug, summary, markdown_content, status, visibility, tags, category, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 'draft', 'public', ?, ?, ?, ?)`
        ).run(id, user.id, parsed.title, uniqueSlug(db, parsed.title), parsed.summary, parsed.markdown_content,
          JSON.stringify(parsed.tags), parsed.category, now, now);
        return json(res, 201, { article: getArticle(db, id) });
      }

      const articleMatch = pathname.match(/^\/api\/articles\/([^/]+)$/);
      if (articleMatch && method === "GET") {
        const article = getArticle(db, articleMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        const user = currentUser(req, db);
        if (article.status !== "published" && !canManage(user, article)) return json(res, 404, { error: "Article not found" });
        db.prepare("UPDATE articles SET view_count = view_count + 1 WHERE id = ?").run(article.id);
        return json(res, 200, { article: publicArticle({ ...article, view_count: article.view_count + 1 }) });
      }

      if (articleMatch && method === "PUT") {
        const user = requireUser(req, db);
        const article = getArticle(db, articleMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        if (!canManage(user, article)) return json(res, 403, { error: "Permission denied" });
        const body = await readJson(req);
        const next = {
          title: body.title ?? article.title,
          summary: body.summary ?? article.summary,
          markdown: body.markdown_content ?? article.markdown_content,
          cover: body.cover_image_url ?? article.cover_image_url,
          visibility: body.visibility ?? article.visibility,
          tags: body.tags ?? article.tags,
          category: body.category ?? article.category
        };
        db.prepare(
          `UPDATE articles SET title = ?, slug = ?, summary = ?, markdown_content = ?, cover_image_url = ?,
           visibility = ?, tags = ?, category = ?, updated_at = ? WHERE id = ?`
        ).run(next.title, uniqueSlug(db, next.title, article.id), next.summary, next.markdown, next.cover, next.visibility,
          JSON.stringify(next.tags), next.category, new Date().toISOString(), article.id);
        return json(res, 200, { article: getArticle(db, article.id) });
      }

      if (articleMatch && method === "DELETE") {
        const user = requireUser(req, db);
        const article = getArticle(db, articleMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        if (!canManage(user, article)) return json(res, 403, { error: "Permission denied" });
        db.prepare("DELETE FROM articles WHERE id = ?").run(article.id);
        return json(res, 204, null);
      }

      const publishMatch = pathname.match(/^\/api\/articles\/([^/]+)\/(publish|unpublish)$/);
      if (publishMatch && method === "POST") {
        const user = requireUser(req, db);
        const article = getArticle(db, publishMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        if (!canManage(user, article)) return json(res, 403, { error: "Permission denied" });
        const publishing = publishMatch[2] === "publish";
        db.prepare("UPDATE articles SET status = ?, published_at = ?, updated_at = ? WHERE id = ?")
          .run(publishing ? "published" : "draft", publishing ? new Date().toISOString() : null, new Date().toISOString(), article.id);
        return json(res, 200, { article: getArticle(db, article.id) });
      }

      const likeMatch = pathname.match(/^\/api\/articles\/([^/]+)\/like$/);
      if (likeMatch && method === "POST") {
        const user = requireUser(req, db);
        db.prepare("INSERT OR IGNORE INTO likes (article_id, user_id, created_at) VALUES (?, ?, ?)")
          .run(likeMatch[1], user.id, new Date().toISOString());
        return json(res, 200, { article: getArticle(db, likeMatch[1]) });
      }
      if (likeMatch && method === "DELETE") {
        const user = requireUser(req, db);
        db.prepare("DELETE FROM likes WHERE article_id = ? AND user_id = ?").run(likeMatch[1], user.id);
        return json(res, 200, { article: getArticle(db, likeMatch[1]) });
      }

      const commentsMatch = pathname.match(/^\/api\/articles\/([^/]+)\/comments$/);
      if (commentsMatch && method === "GET") {
        const comments = db.prepare(
          `SELECT c.*, u.username AS author_name FROM comments c JOIN users u ON u.id = c.user_id
           WHERE c.article_id = ? AND c.status = 'active' ORDER BY c.created_at ASC`
        ).all(commentsMatch[1]);
        return json(res, 200, { comments });
      }
      if (commentsMatch && method === "POST") {
        const user = requireUser(req, db);
        const body = await readJson(req);
        if (!body.content?.trim()) return json(res, 400, { error: "Comment content is required" });
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        db.prepare(
          "INSERT INTO comments (id, article_id, user_id, parent_id, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)"
        ).run(id, commentsMatch[1], user.id, body.parent_id || null, body.content.trim(), now, now);
        return json(res, 201, { comment: db.prepare("SELECT * FROM comments WHERE id = ?").get(id) });
      }

      const commentMatch = pathname.match(/^\/api\/comments\/([^/]+)$/);
      if (commentMatch && method === "DELETE") {
        const user = requireUser(req, db);
        const comment = db.prepare("SELECT * FROM comments WHERE id = ?").get(commentMatch[1]);
        if (!comment) return json(res, 404, { error: "Comment not found" });
        if (user.role !== "admin" && user.id !== comment.user_id) return json(res, 403, { error: "Permission denied" });
        db.prepare("DELETE FROM comments WHERE id = ?").run(comment.id);
        return json(res, 204, null);
      }

      const shareMatch = pathname.match(/^\/api\/articles\/([^/]+)\/share$/);
      if (shareMatch && method === "POST") {
        const user = currentUser(req, db);
        const body = await readJson(req);
        const article = getArticle(db, shareMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        const shareUrl = `${process.env.PUBLIC_BASE_URL || "http://localhost:4173"}/#article-${article.id}`;
        db.prepare("INSERT INTO shares (id, article_id, user_id, platform, share_url, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), article.id, user?.id || null, body.platform || "copy", shareUrl, new Date().toISOString());
        return json(res, 201, { shareUrl, text: `${article.title}\n${article.summary}\n${shareUrl}` });
      }

      const shareCardMatch = pathname.match(/^\/api\/articles\/([^/]+)\/share-card$/);
      if (shareCardMatch && method === "GET") {
        const article = getArticle(db, shareCardMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        const shareUrl = `${process.env.PUBLIC_BASE_URL || "http://localhost:4173"}/#article-${article.id}`;
        return json(res, 200, {
          title: article.title,
          summary: article.summary,
          coverImageUrl: article.cover_image_url,
          shareUrl
        });
      }

      const qrMatch = pathname.match(/^\/api\/articles\/([^/]+)\/share-qrcode$/);
      if (qrMatch && method === "GET") {
        const article = getArticle(db, qrMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        const shareUrl = `${process.env.PUBLIC_BASE_URL || "http://localhost:4173"}/#article-${article.id}`;
        const svg = await QRCode.toString(shareUrl, { type: "svg", margin: 1, width: 320 });
        res.writeHead(200, { "content-type": "image/svg+xml; charset=utf-8", "cache-control": "public, max-age=300" });
        return res.end(svg);
      }

      if (pathname === "/api/admin/dashboard" && method === "GET") {
        requireAdmin(req, db);
        return json(res, 200, {
          users: db.prepare("SELECT COUNT(*) AS count FROM users").get().count,
          articles: db.prepare("SELECT COUNT(*) AS count FROM articles").get().count,
          published: db.prepare("SELECT COUNT(*) AS count FROM articles WHERE status = 'published'").get().count,
          comments: db.prepare("SELECT COUNT(*) AS count FROM comments").get().count,
          views: db.prepare("SELECT COALESCE(SUM(view_count), 0) AS count FROM articles").get().count
        });
      }
      if (pathname === "/api/admin/users" && method === "GET") {
        requireAdmin(req, db);
        return json(res, 200, { users: db.prepare("SELECT * FROM users ORDER BY created_at DESC").all() });
      }
      const adminUserMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
      if (adminUserMatch && method === "PUT") {
        const actor = requireAdmin(req, db);
        const target = db.prepare("SELECT * FROM users WHERE id = ?").get(adminUserMatch[1]);
        if (!target) return json(res, 404, { error: "User not found" });
        const body = await readJson(req);
        const role = body.role || target.role;
        const status = body.status || target.status;
        if (!["admin", "user"].includes(role) || !["active", "disabled"].includes(status)) return json(res, 400, { error: "Invalid role or status" });
        db.prepare("UPDATE users SET role = ?, status = ?, updated_at = ? WHERE id = ?").run(role, status, new Date().toISOString(), target.id);
        audit(db, actor, "user", target.id, "update-role-status", { role: target.role, status: target.status }, { role, status });
        return json(res, 200, { user: db.prepare("SELECT * FROM users WHERE id = ?").get(target.id) });
      }
      if (pathname === "/api/admin/articles" && method === "GET") {
        requireAdmin(req, db);
        return json(res, 200, { articles: db.prepare(`${articleProjection()} ORDER BY a.updated_at DESC`).all().map(serializeArticle) });
      }
      const adminArticleStatusMatch = pathname.match(/^\/api\/admin\/articles\/([^/]+)\/status$/);
      if (adminArticleStatusMatch && method === "PUT") {
        const actor = requireAdmin(req, db);
        const article = getArticle(db, adminArticleStatusMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        const body = await readJson(req);
        if (!["draft", "published", "unlisted"].includes(body.status)) return json(res, 400, { error: "Invalid article status" });
        db.prepare("UPDATE articles SET status = ?, updated_at = ? WHERE id = ?").run(body.status, new Date().toISOString(), article.id);
        audit(db, actor, "article", article.id, "update-status", article.status, body.status);
        return json(res, 200, { article: getArticle(db, article.id) });
      }
      if (pathname === "/api/admin/comments" && method === "GET") {
        requireAdmin(req, db);
        return json(res, 200, { comments: db.prepare("SELECT * FROM comments ORDER BY created_at DESC").all() });
      }

      if (pathname.startsWith("/api/")) return json(res, 404, { error: "API route not found" });
      if (!staticFile(req, res, pathname)) json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, error.status || 500, { error: error.message || "Internal server error" });
    }
  };
}

module.exports = { createApp, parseMarkdownUpload, readJson, slugify };

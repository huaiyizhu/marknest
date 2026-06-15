const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { articleProjection, serializeArticle } = require("./database");
const { currentUser, requireAdmin, requireUser } = require("./auth");
const { findLocalImages, parseFrontMatter, renderMarkdown } = require("../src/markdown");

const root = path.resolve(__dirname, "..");
const imageTypes = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif"
};

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

function detectImageType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.length >= 6 && ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return null;
}

function normalizedImagePath(value) {
  let decoded = String(value || "");
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep malformed user input as-is so it can remain unresolved.
  }
  return decoded
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
}

function replaceImageReferences(markdown, sourcePath, publicUrl) {
  const expected = normalizedImagePath(sourcePath);
  const expectedName = path.posix.basename(expected);
  return String(markdown || "").replace(
    /!\[([^\]]*)\]\(([^)\s]+)(\s+["'][^"']*["'])?\)/g,
    (match, alt, imagePath, title = "") => {
      const candidate = normalizedImagePath(imagePath);
      if (candidate !== expected && path.posix.basename(candidate) !== expectedName) return match;
      return `![${alt}](${publicUrl}${title})`;
    }
  );
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
  const result = parseFrontMatter(markdown);
  const heading = result.body.match(/^#\s+(.+)$/m);
  const rawTags = result.attributes.tags || [];
  return {
    title: result.attributes.title || heading?.[1] || "Untitled",
    summary: result.attributes.summary || result.attributes.description || "",
    category: result.attributes.category || "General",
    tags: (Array.isArray(rawTags) ? rawTags : String(rawTags).split(",")).map((tag) => String(tag).trim()).filter(Boolean),
    markdown_content: result.body,
    rendered_html: renderMarkdown(result.body),
    local_images: findLocalImages(result.body)
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

function canRead(user, article) {
  if (!article) return false;
  if (canManage(user, article)) return true;
  return article.status === "published" && ["public", "unlisted"].includes(article.visibility);
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

function staticFile(req, res, pathname, uploadsDir) {
  if (pathname.startsWith("/uploads/")) {
    const relative = pathname.slice("/uploads/".length);
    const filename = path.resolve(uploadsDir, relative);
    const safeRoot = `${path.resolve(uploadsDir)}${path.sep}`;
    if (!filename.startsWith(safeRoot) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) return false;
    const uploadTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif" };
    res.writeHead(200, {
      "content-type": uploadTypes[path.extname(filename).toLowerCase()] || "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable"
    });
    fs.createReadStream(filename).pipe(res);
    return true;
  }
  const requested = pathname === "/" ? "index.html" : pathname.slice(1);
  const filename = path.resolve(root, requested);
  if (!filename.startsWith(root) || !fs.existsSync(filename) || fs.statSync(filename).isDirectory()) return false;
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".md": "text/markdown" };
  res.writeHead(200, { "content-type": `${types[path.extname(filename)] || "application/octet-stream"}; charset=utf-8` });
  fs.createReadStream(filename).pipe(res);
  return true;
}

function createApp(db, options = {}) {
  const uploadsDir = path.resolve(options.uploadsDir || process.env.UPLOADS_DIR || path.join(root, "data", "uploads"));
  fs.mkdirSync(uploadsDir, { recursive: true });
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
        if (body.visibility && !["public", "unlisted", "private"].includes(body.visibility)) {
          return json(res, 400, { error: "Invalid visibility" });
        }
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO articles
           (id, author_id, title, slug, summary, markdown_content, cover_image_url, status, visibility, tags, category, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(id, user.id, body.title.trim(), uniqueSlug(db, body.title), body.summary || "", body.markdown_content || "",
          body.cover_image_url || null, "draft", body.visibility || "public", JSON.stringify(body.tags || []),
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
        return json(res, 201, { article: getArticle(db, id), localImages: parsed.local_images });
      }

      if (pathname === "/api/assets/images" && method === "POST") {
        const user = requireUser(req, db);
        const body = await readJson(req);
        const article = getArticle(db, body.article_id);
        if (!article) return json(res, 404, { error: "Article not found" });
        if (!canManage(user, article)) return json(res, 403, { error: "Permission denied" });
        if (!body.filename || !body.data_base64) return json(res, 400, { error: "Image filename and data are required" });

        const buffer = Buffer.from(String(body.data_base64), "base64");
        const maxBytes = Number(process.env.MAX_IMAGE_BYTES || 8 * 1024 * 1024);
        if (!buffer.length || buffer.length > maxBytes) return json(res, 400, { error: "Image is empty or exceeds the size limit" });
        const detectedType = detectImageType(buffer);
        if (!detectedType || !imageTypes[detectedType]) return json(res, 400, { error: "Unsupported or invalid image file" });
        if (body.mime_type && body.mime_type !== detectedType) return json(res, 400, { error: "Image MIME type does not match file content" });

        const id = crypto.randomUUID();
        const storageKey = `${article.id}/${id}${imageTypes[detectedType]}`;
        const filename = path.resolve(uploadsDir, storageKey);
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, buffer, { flag: "wx" });
        const publicUrl = `/uploads/${storageKey.replace(/\\/g, "/")}`;
        const sourcePath = body.source_path || body.filename;
        const now = new Date().toISOString();
        db.prepare(
          `INSERT INTO assets
           (id, owner_id, article_id, original_filename, source_path, storage_key, public_url, mime_type, file_size, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
        ).run(id, user.id, article.id, path.basename(body.filename), sourcePath, storageKey, publicUrl,
          detectedType, buffer.length, now, now);

        const nextMarkdown = replaceImageReferences(article.markdown_content, sourcePath, publicUrl);
        db.prepare("UPDATE articles SET markdown_content = ?, updated_at = ? WHERE id = ?")
          .run(nextMarkdown, now, article.id);
        return json(res, 201, {
          asset: db.prepare("SELECT * FROM assets WHERE id = ?").get(id),
          article: getArticle(db, article.id),
          unresolvedImages: findLocalImages(nextMarkdown)
        });
      }

      const articleAssetsMatch = pathname.match(/^\/api\/articles\/([^/]+)\/assets$/);
      if (articleAssetsMatch && method === "GET") {
        const user = requireUser(req, db);
        const article = getArticle(db, articleAssetsMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        if (!canManage(user, article)) return json(res, 403, { error: "Permission denied" });
        return json(res, 200, {
          assets: db.prepare("SELECT * FROM assets WHERE article_id = ? AND status = 'active' ORDER BY created_at DESC")
            .all(article.id),
          unresolvedImages: findLocalImages(article.markdown_content)
        });
      }

      const assetMatch = pathname.match(/^\/api\/assets\/([^/]+)$/);
      if (assetMatch && method === "DELETE") {
        const user = requireUser(req, db);
        const asset = db.prepare("SELECT * FROM assets WHERE id = ?").get(assetMatch[1]);
        if (!asset) return json(res, 404, { error: "Asset not found" });
        const article = getArticle(db, asset.article_id);
        if (!canManage(user, article)) return json(res, 403, { error: "Permission denied" });
        if (article.status === "published") return json(res, 409, { error: "Unpublish the article before deleting an image" });
        const restoredMarkdown = String(article.markdown_content).split(asset.public_url).join(asset.source_path || asset.original_filename);
        db.prepare("UPDATE articles SET markdown_content = ?, updated_at = ? WHERE id = ?")
          .run(restoredMarkdown, new Date().toISOString(), article.id);
        db.prepare("UPDATE assets SET status = 'deleted', updated_at = ? WHERE id = ?")
          .run(new Date().toISOString(), asset.id);
        const filename = path.resolve(uploadsDir, asset.storage_key);
        if (filename.startsWith(`${uploadsDir}${path.sep}`) && fs.existsSync(filename)) fs.unlinkSync(filename);
        return json(res, 204, null);
      }

      const articleMatch = pathname.match(/^\/api\/articles\/([^/]+)$/);
      if (articleMatch && method === "GET") {
        const article = getArticle(db, articleMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        const user = currentUser(req, db);
        if (!canRead(user, article)) return json(res, 404, { error: "Article not found" });
        db.prepare("UPDATE articles SET view_count = view_count + 1 WHERE id = ?").run(article.id);
        return json(res, 200, { article: publicArticle({ ...article, view_count: article.view_count + 1 }) });
      }

      if (articleMatch && method === "PUT") {
        const user = requireUser(req, db);
        const article = getArticle(db, articleMatch[1]);
        if (!article) return json(res, 404, { error: "Article not found" });
        if (!canManage(user, article)) return json(res, 403, { error: "Permission denied" });
        const body = await readJson(req);
        if (body.title != null && !String(body.title).trim()) return json(res, 400, { error: "Title is required" });
        if (body.visibility && !["public", "unlisted", "private"].includes(body.visibility)) {
          return json(res, 400, { error: "Invalid visibility" });
        }
        const next = {
          title: body.title?.trim() ?? article.title,
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
        const unresolvedImages = publishing ? findLocalImages(article.markdown_content) : [];
        if (unresolvedImages.length) {
          return json(res, 409, { error: "Resolve local image references before publishing", unresolvedImages });
        }
        db.prepare("UPDATE articles SET status = ?, published_at = ?, updated_at = ? WHERE id = ?")
          .run(publishing ? "published" : "draft", publishing ? new Date().toISOString() : null, new Date().toISOString(), article.id);
        return json(res, 200, { article: getArticle(db, article.id) });
      }

      const likeMatch = pathname.match(/^\/api\/articles\/([^/]+)\/like$/);
      if (likeMatch && method === "POST") {
        const user = requireUser(req, db);
        const article = getArticle(db, likeMatch[1]);
        if (!canRead(user, article)) return json(res, 404, { error: "Article not found" });
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
        const article = getArticle(db, commentsMatch[1]);
        if (!canRead(currentUser(req, db), article)) return json(res, 404, { error: "Article not found" });
        const comments = db.prepare(
          `SELECT c.*, u.username AS author_name FROM comments c JOIN users u ON u.id = c.user_id
           WHERE c.article_id = ? AND c.status = 'active' ORDER BY c.created_at ASC`
        ).all(commentsMatch[1]);
        return json(res, 200, { comments });
      }
      if (commentsMatch && method === "POST") {
        const user = requireUser(req, db);
        const article = getArticle(db, commentsMatch[1]);
        if (!canRead(user, article)) return json(res, 404, { error: "Article not found" });
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
        if (!canRead(user, article)) return json(res, 404, { error: "Article not found" });
        const shareUrl = `${process.env.PUBLIC_BASE_URL || "http://localhost:4173"}/#article-${article.id}`;
        db.prepare("INSERT INTO shares (id, article_id, user_id, platform, share_url, created_at) VALUES (?, ?, ?, ?, ?, ?)")
          .run(crypto.randomUUID(), article.id, user?.id || null, body.platform || "copy", shareUrl, new Date().toISOString());
        return json(res, 201, { shareUrl, text: `${article.title}\n${article.summary}\n${shareUrl}` });
      }

      const shareCardMatch = pathname.match(/^\/api\/articles\/([^/]+)\/share-card$/);
      if (shareCardMatch && method === "GET") {
        const article = getArticle(db, shareCardMatch[1]);
        if (!canRead(currentUser(req, db), article)) return json(res, 404, { error: "Article not found" });
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
        if (!canRead(currentUser(req, db), article)) return json(res, 404, { error: "Article not found" });
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
      if (!staticFile(req, res, pathname, uploadsDir)) json(res, 404, { error: "Not found" });
    } catch (error) {
      json(res, error.status || 500, { error: error.message || "Internal server error" });
    }
  };
}

module.exports = {
  createApp,
  detectImageType,
  parseMarkdownUpload,
  readJson,
  replaceImageReferences,
  slugify
};

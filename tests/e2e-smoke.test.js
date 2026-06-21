const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const externalBaseUrl = process.env.E2E_BASE_URL || process.argv[2];
const isExternalTarget = Boolean(externalBaseUrl);
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS || 30000);

let db;
let server;
let uploadsDir;
let baseUrl;

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

function devHeaders() {
  return {
    "content-type": "application/json",
    "x-dev-user-id": "e2e-admin",
    "x-dev-provider": "microsoft",
    "x-dev-user-name": "E2E Admin",
    "x-dev-user-email": "e2e-admin@example.com"
  };
}

function appShellAssets(html) {
  return Array.from(html.matchAll(/<(?:link|script)\b[^>]+(?:href|src)="([^"]+)"/g)).map((match) => match[1]);
}

async function assertAppShellAssets(html) {
  const assets = appShellAssets(html);
  assert.ok(assets.includes("/src/styles.css"));
  assert.ok(assets.includes("/src/app.js"));
  assert.ok(assets.includes("/node_modules/markdown-it/dist/markdown-it.min.js"));
  for (const asset of assets) {
    assert.ok(asset.startsWith("/"), `App shell asset must use an absolute path: ${asset}`);
    const result = await request(asset);
    assert.equal(result.response.status, 200, `Expected ${asset} to load`);
  }
}

async function request(targetPath, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${targetPath}`, {
      redirect: "follow",
      ...options,
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    const body = contentType.includes("application/json") && text ? JSON.parse(text) : text;
    return { response, body, text };
  } catch (error) {
    error.message = `${targetPath}: ${error.message}`;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function startLocalTarget() {
  process.env.ADMIN_IDENTITIES = "microsoft:e2e-admin";
  const { createApp } = require("../server/app");
  const { createDatabase } = require("../server/database");
  db = createDatabase(":memory:");
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "marknest-e2e-"));
  server = http.createServer(createApp(db, { uploadsDir }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function seedLocalArticle() {
  const created = await request("/api/articles", {
    method: "POST",
    headers: devHeaders(),
    body: JSON.stringify({
      title: "E2E Markdown Table",
      summary: "Smoke test article",
      markdown_content: "# E2E Markdown Table\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n![Remote](https://example.com/image.png)",
      category: "Testing",
      tags: ["e2e", "markdown"],
      style_preset: "technical"
    })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.article.style_preset, "technical");

  const published = await request(`/api/articles/${created.body.article.id}/publish`, {
    method: "POST",
    headers: devHeaders()
  });
  assert.equal(published.response.status, 200);
  assert.equal(published.body.article.status, "published");
  return published.body.article;
}

async function assertCoreSurface() {
  const health = await request("/api/health");
  assert.equal(health.response.status, 200);
  assert.deepEqual(health.body, { status: "ok" });

  const html = await request("/");
  assert.equal(html.response.status, 200);
  assert.match(html.text, /<title>Marknest<\/title>/);
  assert.match(html.text, /id="stylePresetInput"/);
  assert.match(html.text, /id="togglePrimaryNavButton"/);
  assert.match(html.text, /id="toggleSecondarySidebarButton"/);
  await assertAppShellAssets(html.text);

  const appJs = await request("/src/app.js");
  assert.equal(appJs.response.status, 200);
  assert.match(appJs.text, /accountMenuButton/);
  assert.match(appJs.text, /stylePresetClass/);

  const css = await request("/src/styles.css");
  assert.equal(css.response.status, 200);
  assert.match(css.text, /article-style-technical/);
  assert.match(css.text, /secondary-sidebar-collapsed/);

  const markdownIt = await request("/node_modules/markdown-it/dist/markdown-it.min.js");
  assert.equal(markdownIt.response.status, 200);

  const providers = await request("/api/auth/providers");
  assert.equal(providers.response.status, 200);
  assert.ok(Array.isArray(providers.body.providers));

  const me = await request("/api/auth/me");
  assert.equal(me.response.status, 200);
  assert.equal(typeof me.body.authenticated, "boolean");

  const articles = await request("/api/articles");
  assert.equal(articles.response.status, 200);
  assert.ok(Array.isArray(articles.body.articles));
  return articles.body.articles;
}

async function assertArticleReadPath(article) {
  const identifier = article.slug || article.id;
  const articleResult = await request(`/api/articles/${encodeURIComponent(identifier)}`);
  assert.equal(articleResult.response.status, 200);
  assert.equal(articleResult.body.article.id, article.id);
  assert.equal(typeof articleResult.body.article.markdown_content, "string");
  assert.ok(articleResult.body.article.markdown_content.length > 0);

  const appRoute = await request(`/articles/${encodeURIComponent(identifier)}`);
  assert.equal(appRoute.response.status, 200);
  assert.match(appRoute.text, /<title>Marknest<\/title>/);
  await assertAppShellAssets(appRoute.text);

  const shareCard = await request(`/api/articles/${encodeURIComponent(identifier)}/share-card`);
  assert.equal(shareCard.response.status, 200);
  assert.equal(shareCard.body.title, article.title);
  assert.match(shareCard.body.shareUrl, /\/articles\//);
}

async function run() {
  if (isExternalTarget) {
    baseUrl = normalizeBaseUrl(externalBaseUrl);
  } else {
    await startLocalTarget();
  }

  try {
    const seededArticle = isExternalTarget ? null : await seedLocalArticle();
    const articles = await assertCoreSurface();
    const article = seededArticle || articles[0];
    if (article) {
      await assertArticleReadPath(article);
    } else {
      console.log("No public articles found; skipped public article detail smoke check.");
    }
    console.log(`E2E smoke tests passed for ${baseUrl}`);
  } finally {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) db.close();
    if (uploadsDir && path.resolve(uploadsDir).startsWith(path.resolve(os.tmpdir()))) {
      fs.rmSync(uploadsDir, { recursive: true, force: true });
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

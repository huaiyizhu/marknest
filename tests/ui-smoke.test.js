const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { chromium } = require("playwright");

const externalBaseUrl = process.env.E2E_BASE_URL || process.argv[2];
const isExternalTarget = Boolean(externalBaseUrl);
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS || 90000);

let db;
let server;
let uploadsDir;
let baseUrl;
let browser;

function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

function devHeaders() {
  return {
    "content-type": "application/json",
    "x-dev-user-id": "ui-admin",
    "x-dev-provider": "microsoft",
    "x-dev-user-name": "UI Admin",
    "x-dev-user-email": "ui-admin@example.com"
  };
}

async function request(targetPath, options = {}) {
  const response = await fetch(`${baseUrl}${targetPath}`, { redirect: "follow", ...options });
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();
  const body = contentType.includes("application/json") && text ? JSON.parse(text) : text;
  return { response, body, text };
}

async function startLocalTarget() {
  process.env.ADMIN_IDENTITIES = "microsoft:ui-admin";
  const { createApp } = require("../server/app");
  const { createDatabase } = require("../server/database");
  db = createDatabase(":memory:");
  uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "marknest-ui-"));
  server = http.createServer(createApp(db, { uploadsDir }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function seedLocalArticle() {
  const created = await request("/api/articles", {
    method: "POST",
    headers: devHeaders(),
    body: JSON.stringify({
      title: "UI 深链接测试",
      summary: "Browser UI smoke test article.",
      markdown_content: "# UI 深链接测试\n\n这是一篇用于浏览器 UI 验证的文章。\n\n| 功能 | 状态 |\n| --- | --- |\n| Markdown 表格 | 正常 |",
      category: "Testing",
      tags: ["ui", "e2e"],
      style_preset: "technical"
    })
  });
  assert.equal(created.response.status, 201);
  const published = await request(`/api/articles/${created.body.article.id}/publish`, {
    method: "POST",
    headers: devHeaders()
  });
  assert.equal(published.response.status, 200);
  return published.body.article;
}

async function publicArticle() {
  const listed = await request("/api/articles");
  assert.equal(listed.response.status, 200);
  assert.ok(Array.isArray(listed.body.articles));
  return listed.body.articles[0] || null;
}

async function launchBrowser() {
  const options = { headless: true };
  const channel = process.env.PLAYWRIGHT_CHANNEL || (process.platform === "win32" ? "msedge" : "");
  if (channel) options.channel = channel;
  return chromium.launch(options);
}

async function assertStyledApp(page) {
  const result = await page.evaluate(() => {
    const topbar = document.querySelector(".topbar");
    const brandMark = document.querySelector(".brand-mark");
    const article = document.querySelector("#articleDetail");
    const sidebar = document.querySelector(".document-sidebar");
    const largestSvg = Math.max(0, ...Array.from(document.querySelectorAll("svg")).map((svg) => svg.getBoundingClientRect().width));
    return {
      bodyFont: getComputedStyle(document.body).fontFamily,
      topbarDisplay: topbar && getComputedStyle(topbar).display,
      topbarPosition: topbar && getComputedStyle(topbar).position,
      brandMarkWidth: brandMark && Math.round(brandMark.getBoundingClientRect().width),
      articleClass: article && article.className,
      articleWidth: article && Math.round(article.getBoundingClientRect().width),
      sidebarDisplay: sidebar && getComputedStyle(sidebar).display,
      largestSvg
    };
  });
  assert.equal(result.topbarDisplay, "grid");
  assert.equal(result.topbarPosition, "sticky");
  assert.ok(result.bodyFont.includes("Inter") || result.bodyFont.includes("Segoe UI"), result.bodyFont);
  assert.ok(result.brandMarkWidth >= 36 && result.brandMarkWidth <= 48, `Unexpected brand width: ${result.brandMarkWidth}`);
  assert.ok(result.articleClass.includes("social-article"));
  assert.ok(result.articleWidth > 500, `Article card is too narrow: ${result.articleWidth}`);
  assert.notEqual(result.sidebarDisplay, "none");
  assert.ok(result.largestSvg <= 30, `SVG icon rendered too large: ${result.largestSvg}`);
}

async function run() {
  if (isExternalTarget) {
    baseUrl = normalizeBaseUrl(externalBaseUrl);
  } else {
    await startLocalTarget();
  }

  try {
    const article = isExternalTarget ? await publicArticle() : await seedLocalArticle();
    assert.ok(article, "At least one public article is required for deployed UI smoke tests.");

    browser = await launchBrowser();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(timeoutMs);
    if (!isExternalTarget) {
      await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
      await page.evaluate(() => localStorage.setItem("marknest-dev-identity", JSON.stringify({
        provider: "microsoft",
        providerUserId: "ui-admin",
        name: "UI Admin",
        email: "ui-admin@example.com"
      })));
    }

    const slug = encodeURIComponent(article.slug || article.id);
    await page.goto(`${baseUrl}/articles/${slug}`, { waitUntil: "networkidle" });
    await assertStyledApp(page);
    await page.waitForSelector(".markdown-body");
    assert.ok((await page.locator("#articleDetail").innerText()).includes(article.title));

    await page.click("#togglePrimaryNavButton");
    assert.equal(await page.evaluate(() => document.body.classList.contains("primary-nav-expanded")), true);
    await page.click("#toggleSecondarySidebarButton");
    assert.equal(await page.evaluate(() => document.body.classList.contains("secondary-sidebar-collapsed")), true);

    if (!isExternalTarget) {
      await page.click("#accountMenuButton");
      assert.ok((await page.locator("#accountMenu").innerText()).includes("UI Admin"));
    }

    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobilePage = await mobile.newPage();
    mobilePage.setDefaultTimeout(timeoutMs);
    await mobilePage.goto(`${baseUrl}/articles/${slug}`, { waitUntil: "networkidle" });
    const mobileState = await mobilePage.evaluate(() => ({
      canScrollX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      railPosition: getComputedStyle(document.querySelector(".icon-rail")).position,
      sidebarDisplay: getComputedStyle(document.querySelector(".document-sidebar")).display
    }));
    assert.equal(mobileState.canScrollX, false);
    assert.equal(mobileState.railPosition, "fixed");
    assert.equal(mobileState.sidebarDisplay, "none");

    console.log(`UI smoke tests passed for ${baseUrl}`);
  } finally {
    if (browser) await browser.close();
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

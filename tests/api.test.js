const assert = require("node:assert/strict");
const http = require("node:http");
const { createApp } = require("../server/app");
const { createDatabase } = require("../server/database");

const db = createDatabase(":memory:");
const server = http.createServer(createApp(db));

function headers(userId, provider = "microsoft") {
  return {
    "content-type": "application/json",
    "x-dev-user-id": userId,
    "x-dev-provider": provider,
    "x-dev-user-name": userId === "demo-admin" ? "Ada Admin" : "Grace Writer",
    "x-dev-user-email": `${userId}@example.com`
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null
  };
}

let baseUrl;

async function run() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;

  try {
  process.env.ADMIN_EMAILS = "production@example.com";
  const health = await request("/api/health");
  assert.equal(health.status, 200);

  const providers = await request("/api/auth/providers");
  assert.deepEqual(providers.body.providers.map((provider) => provider.id), ["microsoft", "google"]);

  const anonymousMe = await request("/api/auth/me");
  assert.equal(anonymousMe.status, 200);
  assert.equal(anonymousMe.body.authenticated, false);
  assert.equal(anonymousMe.body.user, null);

  const adminMe = await request("/api/auth/me", { headers: headers("demo-admin") });
  assert.equal(adminMe.body.authenticated, true);
  assert.equal(adminMe.body.user.role, "admin");

  const userMe = await request("/api/auth/me", { headers: headers("demo-writer", "google") });
  assert.equal(userMe.body.user.role, "user");

  const easyAuthHeaders = await request("/api/auth/me", {
    headers: {
      "x-ms-client-principal-id": "production-user",
      "x-ms-client-principal-idp": "aad",
      "x-ms-client-principal-name": "production@example.com"
    }
  });
  assert.equal(easyAuthHeaders.body.authenticated, true);
  assert.equal(easyAuthHeaders.body.user.provider_user_id, "production-user");
  assert.equal(easyAuthHeaders.body.user.role, "admin");

  const uploaded = await request("/api/articles/upload-md", {
    method: "POST",
    headers: headers("demo-writer", "google"),
    body: JSON.stringify({
      markdown: "---\ntitle: Uploaded Note\ntags: markdown, upload\ncategory: Notes\n---\n\n# Uploaded Note\n\nBody"
    })
  });
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.article.title, "Uploaded Note");
  assert.deepEqual(uploaded.body.article.tags, ["markdown", "upload"]);

  const uploadedWithLocalImage = await request("/api/articles/upload-md", {
    method: "POST",
    headers: headers("demo-writer", "google"),
    body: JSON.stringify({ markdown: "---\ntags: [one, two]\n---\n# Images\n\n![Local](./image.png)" })
  });
  assert.deepEqual(uploadedWithLocalImage.body.article.tags, ["one", "two"]);
  assert.deepEqual(uploadedWithLocalImage.body.localImages, [{ alt: "Local", path: "./image.png" }]);

  const created = await request("/api/articles", {
    method: "POST",
    headers: headers("demo-writer", "google"),
    body: JSON.stringify({
      title: "API Article",
      summary: "Created by an integration test.",
      markdown_content: "# API Article\n\nHello.",
      category: "Testing",
      tags: ["api", "test"]
    })
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.article.status, "draft");
  const articleId = created.body.article.id;

  const anonymousDraft = await request(`/api/articles/${articleId}`);
  assert.equal(anonymousDraft.status, 404);

  const invalidVisibility = await request(`/api/articles/${articleId}`, {
    method: "PUT",
    headers: headers("demo-writer", "google"),
    body: JSON.stringify({ visibility: "everyone" })
  });
  assert.equal(invalidVisibility.status, 400);

  const published = await request(`/api/articles/${articleId}/publish`, {
    method: "POST",
    headers: headers("demo-writer", "google")
  });
  assert.equal(published.status, 200);
  assert.equal(published.body.article.status, "published");

  const madePrivate = await request(`/api/articles/${articleId}`, {
    method: "PUT",
    headers: headers("demo-writer", "google"),
    body: JSON.stringify({ visibility: "private" })
  });
  assert.equal(madePrivate.status, 200);
  assert.equal((await request(`/api/articles/${articleId}`)).status, 404);
  await request(`/api/articles/${articleId}`, {
    method: "PUT",
    headers: headers("demo-writer", "google"),
    body: JSON.stringify({ visibility: "public" })
  });

  const listed = await request("/api/articles");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.articles.length, 1);

  const liked = await request(`/api/articles/${articleId}/like`, {
    method: "POST",
    headers: headers("demo-admin")
  });
  assert.equal(liked.body.article.like_count, 1);

  const commented = await request(`/api/articles/${articleId}/comments`, {
    method: "POST",
    headers: headers("demo-admin"),
    body: JSON.stringify({ content: "Useful article." })
  });
  assert.equal(commented.status, 201);

  const comments = await request(`/api/articles/${articleId}/comments`);
  assert.equal(comments.body.comments.length, 1);

  const shared = await request(`/api/articles/${articleId}/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ platform: "wechat" })
  });
  assert.equal(shared.status, 201);
  assert.match(shared.body.text, /API Article/);

  const shareCard = await request(`/api/articles/${articleId}/share-card`);
  assert.equal(shareCard.status, 200);
  assert.equal(shareCard.body.title, "API Article");

  const qrResponse = await fetch(`${baseUrl}/api/articles/${articleId}/share-qrcode`);
  assert.equal(qrResponse.status, 200);
  assert.match(qrResponse.headers.get("content-type"), /image\/svg\+xml/);
  assert.match(await qrResponse.text(), /<svg/);

  const locale = await request("/api/users/me/locale", {
    method: "PUT",
    headers: headers("demo-writer", "google"),
    body: JSON.stringify({ locale: "en-US" })
  });
  assert.equal(locale.status, 200);

  const forbiddenAdmin = await request("/api/admin/dashboard", {
    headers: headers("demo-writer", "google")
  });
  assert.equal(forbiddenAdmin.status, 403);

  const dashboard = await request("/api/admin/dashboard", {
    headers: headers("demo-admin")
  });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.body.published, 1);
  assert.equal(dashboard.body.comments, 1);

  const unlisted = await request(`/api/admin/articles/${articleId}/status`, {
    method: "PUT",
    headers: headers("demo-admin"),
    body: JSON.stringify({ status: "unlisted" })
  });
  assert.equal(unlisted.status, 200);
  assert.equal(unlisted.body.article.status, "unlisted");

  const otherUserUpdate = await request(`/api/articles/${articleId}`, {
    method: "PUT",
    headers: headers("other-writer", "google"),
    body: JSON.stringify({ title: "Unauthorized edit" })
  });
  assert.equal(otherUserUpdate.status, 403);

    console.log("API integration tests passed");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

const ADMIN_IDENTITIES = new Set(["microsoft:demo-admin"]);

const demoUsers = [
  {
    id: "u-admin",
    provider: "microsoft",
    providerUserId: "demo-admin",
    name: "Ada Admin",
    email: "ada.admin@example.com",
    role: "admin",
    preferredLocale: "zh-CN"
  },
  {
    id: "u-google",
    provider: "google",
    providerUserId: "demo-writer",
    name: "Grace Writer",
    email: "grace.writer@example.com",
    role: "user",
    preferredLocale: "en-US"
  }
];

const starterMarkdown = `---
title: Build a Markdown Blog on Azure
tags: markdown, azure, ci
category: Engineering
summary: A practical note about turning Markdown articles into a personal blog.
---

# Build a Markdown Blog on Azure

Markdown is a durable writing format for technical notes, project journals, and public articles.

## Why this works

- Content stays portable
- Code blocks are easy to read
- GitHub can manage version history

\`\`\`js
const platform = "Marknest";
console.log(\`\${platform} renders Markdown into a blog.\`);
\`\`\`

> Start simple, keep the content portable, and automate the boring parts.
`;

const initialState = {
  currentUser: demoUsers[0],
  users: demoUsers,
  locale: MarknestI18n.normalizeLocale(localStorage.getItem("marknest-locale") || navigator.language),
  selectedArticleId: "a-1",
  editingArticleId: null,
  articles: [
    {
      id: "a-1",
      authorId: "u-admin",
      title: "Build a Markdown Blog on Azure",
      summary: "A practical note about turning Markdown articles into a personal blog.",
      category: "Engineering",
      tags: ["markdown", "azure", "ci"],
      markdown: starterMarkdown,
      status: "published",
      visibility: "public",
      views: 128,
      likes: 24,
      shares: 7,
      publishedAt: "2026-06-13",
      comments: [
        { id: "c-1", author: "Reader", content: "The GitHub Actions flow is exactly what I needed." }
      ]
    }
  ]
};

const state = loadState();
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
let t = MarknestI18n.createTranslator(state.locale);

function loadState() {
  const saved = localStorage.getItem("marknest-state");
  if (!saved) {
    return structuredClone(initialState);
  }

  try {
    const parsed = JSON.parse(saved);
    return {
      ...structuredClone(initialState),
      ...parsed,
      locale: MarknestI18n.normalizeLocale(parsed.locale || localStorage.getItem("marknest-locale") || navigator.language)
    };
  } catch {
    return structuredClone(initialState);
  }
}

function persist() {
  localStorage.setItem("marknest-locale", state.locale);
  localStorage.setItem("marknest-state", JSON.stringify(state));
}

function translate(key) {
  return t(key);
}

function identityKey(user) {
  return `${user.provider}:${user.providerUserId}`;
}

function roleFor(user) {
  return ADMIN_IDENTITIES.has(identityKey(user)) ? "admin" : "user";
}

function setLocale(locale) {
  state.locale = MarknestI18n.normalizeLocale(locale);
  t = MarknestI18n.createTranslator(state.locale);

  if (state.currentUser) {
    state.currentUser.preferredLocale = state.locale;
    const user = state.users.find((item) => item.id === state.currentUser.id);
    if (user) {
      user.preferredLocale = state.locale;
    }
  }

  persist();
  render();
}

function renderStaticTranslations() {
  document.documentElement.lang = state.locale;

  $$("[data-i18n]").forEach((element) => {
    element.textContent = translate(element.dataset.i18n);
  });

  $$("[data-i18n-placeholder]").forEach((element) => {
    element.setAttribute("placeholder", translate(element.dataset.i18nPlaceholder));
  });

  $("#localeSelect").innerHTML = MarknestI18n.SUPPORTED_LOCALES.map(
    (locale) => `<option value="${locale}" ${locale === state.locale ? "selected" : ""}>${MarknestI18n.LOCALE_LABELS[locale]}</option>`
  ).join("");
}

function signIn(provider) {
  const baseUser = provider === "microsoft" ? demoUsers[0] : demoUsers[1];
  const user = { ...baseUser, role: roleFor(baseUser) };

  state.currentUser = { ...user, preferredLocale: state.locale };
  if (!state.users.some((item) => item.id === user.id)) {
    state.users.push(state.currentUser);
  }
  persist();
  render();
}

function signOut() {
  state.currentUser = null;
  persist();
  render();
}

function requireUser() {
  if (state.currentUser) {
    return true;
  }
  alert(translate("signInRequired"));
  return false;
}

function canEdit(article) {
  return state.currentUser && (state.currentUser.role === "admin" || article.authorId === state.currentUser.id);
}

function renderAuth() {
  const panel = $("#authPanel");
  document.body.classList.toggle("is-admin", state.currentUser?.role === "admin");

  if (!state.currentUser) {
    panel.innerHTML = `
      <button data-signin="microsoft">${translate("signInMicrosoft")}</button>
      <button data-signin="google">${translate("signInGoogle")}</button>
    `;
    return;
  }

  const roleLabel = state.currentUser.role === "admin" ? translate("roleAdmin") : translate("roleUser");
  panel.innerHTML = `
    <div class="user-chip">
      <strong>${state.currentUser.name}</strong>
      <span>${state.currentUser.provider} - ${roleLabel}</span>
    </div>
    <button id="signOutButton">${translate("signOut")}</button>
  `;
}

function articleHtml(article) {
  return MarknestMarkdown.renderMarkdown(article.markdown);
}

function articleStats(article) {
  return article.views + article.likes + article.comments.length + article.shares;
}

function renderArticleList() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const articles = state.articles.filter((article) => {
    if (article.status !== "published") {
      return false;
    }
    const haystack = [article.title, article.summary, article.category, article.tags.join(" ")].join(" ").toLowerCase();
    return haystack.includes(query);
  });

  $("#articleList").innerHTML =
    articles
      .map(
        (article) => `
      <button class="article-row ${article.id === state.selectedArticleId ? "active" : ""}" data-select-article="${article.id}">
        <strong>${article.title}</strong>
        <span>${article.category} - ${article.tags.join(", ")}</span>
      </button>
    `
      )
      .join("") || `<p class="empty-state">${translate("noArticleMatches")}</p>`;

  if (!articles.some((article) => article.id === state.selectedArticleId)) {
    state.selectedArticleId = articles[0]?.id || null;
  }
}

function renderArticleDetail() {
  const article = state.articles.find((item) => item.id === state.selectedArticleId);
  const detail = $("#articleDetail");

  if (!article) {
    detail.innerHTML = `<p class="empty-state">${translate("selectArticle")}</p>`;
    return;
  }

  article.views += 1;
  persist();

  detail.innerHTML = `
    <div class="article-meta">${article.category} - ${article.tags.join(", ")} - ${article.publishedAt || translate("draft")}</div>
    <h2>${article.title}</h2>
    <p>${article.summary}</p>
    <div class="markdown-body">${articleHtml(article)}</div>
    <div class="article-actions">
      <button data-like="${article.id}">${translate("like")} ${article.likes}</button>
      <button data-share="${article.id}" data-platform="copy">${translate("copyLink")}</button>
      <button data-share="${article.id}" data-platform="wechat">${translate("wechat")}</button>
      <button data-share="${article.id}" data-platform="xiaohongshu">${translate("xiaohongshu")}</button>
      ${canEdit(article) ? `<button data-edit="${article.id}">${translate("edit")}</button>` : ""}
    </div>
    <div class="share-box" id="shareBox"></div>
    <div class="comments-box">
      <h3>${translate("comments")}</h3>
      <div id="commentsList">
        ${article.comments.map((comment) => `<div class="comment"><strong>${comment.author}</strong><p>${comment.content}</p></div>`).join("")}
      </div>
      <form id="commentForm">
        <input id="commentInput" type="text" placeholder="${translate("addComment")}" />
      </form>
    </div>
  `;
}

function startNewArticle() {
  if (!requireUser()) {
    return;
  }
  state.editingArticleId = null;
  $("#titleInput").value = "";
  $("#summaryInput").value = "";
  $("#categoryInput").value = "";
  $("#tagsInput").value = "";
  $("#markdownInput").value = `# ${translate("untitled")}\n\n${translate("startWriting")}`;
  $("#draftStatus").textContent = translate("draft");
  updatePreview();
}

function loadArticleIntoEditor(articleId) {
  const article = state.articles.find((item) => item.id === articleId);
  if (!article || !canEdit(article)) {
    return;
  }
  showView("workspace");
  state.editingArticleId = article.id;
  $("#titleInput").value = article.title;
  $("#summaryInput").value = article.summary;
  $("#categoryInput").value = article.category;
  $("#tagsInput").value = article.tags.join(", ");
  $("#markdownInput").value = article.markdown;
  $("#draftStatus").textContent = article.status === "published" ? translate("published") : translate("draft");
  updatePreview();
}

function formArticle(status) {
  const title = $("#titleInput").value.trim() || translate("untitled");
  return {
    id: state.editingArticleId || `a-${Date.now()}`,
    authorId: state.currentUser.id,
    title,
    summary: $("#summaryInput").value.trim() || translate("noSummary"),
    category: $("#categoryInput").value.trim() || translate("general"),
    tags: $("#tagsInput").value.split(",").map((tag) => tag.trim()).filter(Boolean),
    markdown: $("#markdownInput").value,
    status,
    visibility: "public",
    views: 0,
    likes: 0,
    shares: 0,
    publishedAt: status === "published" ? new Date().toISOString().slice(0, 10) : null,
    comments: []
  };
}

function saveArticle(status) {
  if (!requireUser()) {
    return;
  }

  const article = formArticle(status);
  const existingIndex = state.articles.findIndex((item) => item.id === article.id);
  if (existingIndex > -1) {
    const previous = state.articles[existingIndex];
    state.articles[existingIndex] = { ...previous, ...article, views: previous.views, likes: previous.likes, shares: previous.shares, comments: previous.comments };
  } else {
    state.articles.unshift(article);
  }

  state.editingArticleId = article.id;
  if (status === "published") {
    state.selectedArticleId = article.id;
  }
  $("#draftStatus").textContent = status === "published" ? translate("published") : translate("draft");
  $("#autosaveStatus").textContent = `${translate("saved")} ${new Date().toLocaleTimeString()}`;
  persist();
  render();
}

function updatePreview() {
  $("#previewOutput").innerHTML = MarknestMarkdown.renderMarkdown($("#markdownInput").value);
  $("#autosaveStatus").textContent = translate("editing");
}

function uploadMarkdown(file) {
  if (!requireUser() || !file) {
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const parsed = MarknestMarkdown.parseFrontMatter(reader.result);
    const titleMatch = parsed.body.match(/^#\s+(.+)$/m);
    $("#titleInput").value = parsed.attributes.title || titleMatch?.[1] || file.name.replace(/\.md$/i, "");
    $("#summaryInput").value = parsed.attributes.summary || parsed.attributes.description || "";
    $("#categoryInput").value = parsed.attributes.category || "";
    $("#tagsInput").value = parsed.attributes.tags || "";
    $("#markdownInput").value = parsed.body;
    state.editingArticleId = null;
    updatePreview();
  };
  reader.readAsText(file);
}

function shareArticle(articleId, platform) {
  const article = state.articles.find((item) => item.id === articleId);
  if (!article) {
    return;
  }

  article.shares += 1;
  const url = `${location.origin}${location.pathname}#article-${article.id}`;
  const message = `${article.title}\n${article.summary}\n${url}`;
  const platformNames = {
    copy: translate("copiedShareText"),
    wechat: translate("wechatShareText"),
    xiaohongshu: translate("xiaohongshuShareText")
  };

  navigator.clipboard?.writeText(message);
  $("#shareBox").innerHTML = `
    <strong>${platformNames[platform]}</strong>
    <p>${message.replace(/\n/g, "<br />")}</p>
    <p>${translate("qrPlaceholder")}: ${url}</p>
  `;
  persist();
  renderStats();
}

function renderStats() {
  const visibleArticles = state.currentUser?.role === "admin" ? state.articles : state.articles.filter((article) => article.authorId === state.currentUser?.id);
  const totals = visibleArticles.reduce(
    (acc, article) => {
      acc.views += article.views;
      acc.likes += article.likes;
      acc.comments += article.comments.length;
      acc.shares += article.shares;
      return acc;
    },
    { views: 0, likes: 0, comments: 0, shares: 0 }
  );
  const labels = {
    views: translate("metricViews"),
    likes: translate("metricLikes"),
    comments: translate("metricComments"),
    shares: translate("metricShares")
  };

  $("#statsGrid").innerHTML = Object.entries(totals)
    .map(([label, value]) => `<div class="stat-card"><span class="metric-label">${labels[label]}</span><span class="metric-value">${value}</span></div>`)
    .join("");
}

function renderAdmin() {
  const published = state.articles.filter((article) => article.status === "published");
  const draft = state.articles.filter((article) => article.status === "draft");
  const comments = state.articles.flatMap((article) => article.comments);
  const topArticle = [...state.articles].sort((a, b) => articleStats(b) - articleStats(a))[0];

  $("#adminGrid").innerHTML = `
    <div class="admin-card"><span class="metric-label">${translate("users")}</span><span class="metric-value">${state.users.length}</span></div>
    <div class="admin-card"><span class="metric-label">${translate("published")}</span><span class="metric-value">${published.length}</span></div>
    <div class="admin-card"><span class="metric-label">${translate("drafts")}</span><span class="metric-value">${draft.length}</span></div>
    <div class="admin-card"><span class="metric-label">${translate("comments")}</span><span class="metric-value">${comments.length}</span></div>
    <div class="admin-card">
      <h3>${translate("adminIdentities")}</h3>
      <ul>${Array.from(ADMIN_IDENTITIES).map((item) => `<li>${item}</li>`).join("")}</ul>
    </div>
    <div class="admin-card">
      <h3>${translate("topArticle")}</h3>
      <p>${topArticle?.title || translate("noArticlesYet")}</p>
    </div>
    <div class="admin-card">
      <h3>${translate("deployment")}</h3>
      <p>${translate("deploymentStatus")}</p>
    </div>
    <div class="admin-card">
      <h3>${translate("audit")}</h3>
      <p>${translate("auditStatus")}</p>
    </div>
  `;
}

function showView(name) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}View`));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) {
      return;
    }

    if (target.dataset.signin) {
      signIn(target.dataset.signin);
    } else if (target.id === "signOutButton") {
      signOut();
    } else if (target.dataset.view) {
      showView(target.dataset.view);
    } else if (target.dataset.selectArticle) {
      state.selectedArticleId = target.dataset.selectArticle;
      renderArticleList();
      renderArticleDetail();
    } else if (target.dataset.like) {
      const article = state.articles.find((item) => item.id === target.dataset.like);
      article.likes += 1;
      persist();
      renderArticleDetail();
      renderStats();
    } else if (target.dataset.share) {
      shareArticle(target.dataset.share, target.dataset.platform);
    } else if (target.dataset.edit) {
      loadArticleIntoEditor(target.dataset.edit);
    }
  });

  $("#newArticleButton").addEventListener("click", startNewArticle);
  $("#saveDraftButton").addEventListener("click", () => saveArticle("draft"));
  $("#publishButton").addEventListener("click", () => saveArticle("published"));
  $("#markdownInput").addEventListener("input", updatePreview);
  $("#markdownFile").addEventListener("change", (event) => uploadMarkdown(event.target.files[0]));
  $("#localeSelect").addEventListener("change", (event) => setLocale(event.target.value));
  $("#searchInput").addEventListener("input", () => {
    renderArticleList();
    renderArticleDetail();
  });

  document.addEventListener("submit", (event) => {
    if (event.target.id !== "commentForm") {
      return;
    }
    event.preventDefault();
    if (!requireUser()) {
      return;
    }
    const input = $("#commentInput");
    const article = state.articles.find((item) => item.id === state.selectedArticleId);
    if (article && input.value.trim()) {
      article.comments.push({ id: `c-${Date.now()}`, author: state.currentUser.name, content: input.value.trim() });
      input.value = "";
      persist();
      renderArticleDetail();
      renderStats();
    }
  });
}

function render() {
  renderStaticTranslations();
  renderAuth();
  renderArticleList();
  renderArticleDetail();
  renderStats();
  renderAdmin();
}

bindEvents();
render();
loadArticleIntoEditor(state.articles[0].id);
showView("reader");


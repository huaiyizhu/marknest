const state = {
  currentUser: null,
  authProviders: [],
  articles: [],
  selectedArticleId: null,
  editingArticleId: null,
  locale: MarknestI18n.normalizeLocale(localStorage.getItem("marknest-locale") || navigator.language)
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
let t = MarknestI18n.createTranslator(state.locale);

function translate(key) {
  return t(key);
}

function showError(error) {
  console.error(error);
  alert(error.message || "Unexpected error");
}

async function setLocale(locale) {
  state.locale = MarknestI18n.normalizeLocale(locale);
  t = MarknestI18n.createTranslator(state.locale);
  localStorage.setItem("marknest-locale", state.locale);
  if (state.currentUser) {
    try {
      await MarknestApi.request("/api/users/me/locale", {
        method: "PUT",
        body: JSON.stringify({ locale: state.locale })
      });
    } catch (error) {
      showError(error);
    }
  }
  render();
}

function renderStaticTranslations() {
  document.documentElement.lang = state.locale;
  $$("[data-i18n]").forEach((element) => {
    element.textContent = translate(element.dataset.i18n);
  });
  $$("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = translate(element.dataset.i18nPlaceholder);
  });
  $("#localeSelect").innerHTML = MarknestI18n.SUPPORTED_LOCALES.map(
    (locale) => `<option value="${locale}" ${locale === state.locale ? "selected" : ""}>${MarknestI18n.LOCALE_LABELS[locale]}</option>`
  ).join("");
}

async function refreshSession() {
  const result = await MarknestApi.request("/api/auth/me");
  state.currentUser = result.user;
  if (state.currentUser?.preferred_locale) {
    state.locale = MarknestI18n.normalizeLocale(state.currentUser.preferred_locale);
    t = MarknestI18n.createTranslator(state.locale);
    localStorage.setItem("marknest-locale", state.locale);
  }
}

async function loadAuthProviders() {
  const result = await MarknestApi.request("/api/auth/providers");
  state.authProviders = result.providers || [];
}

async function loadArticles() {
  const result = await MarknestApi.request("/api/articles");
  state.articles = result.articles;
  if (!state.articles.some((article) => article.id === state.selectedArticleId)) {
    state.selectedArticleId = state.articles[0]?.id || null;
  }
}

async function signIn(provider) {
  if (!MarknestApi.signIn(provider)) return;
  await refreshSession();
  await loadArticles();
  render();
}

async function signOut() {
  if (!MarknestApi.signOut()) return;
  state.currentUser = null;
  render();
}

function requireUser() {
  if (state.currentUser) return true;
  alert(translate("signInRequired"));
  return false;
}

function canEdit(article) {
  return state.currentUser && (state.currentUser.role === "admin" || article.author_id === state.currentUser.id);
}

function renderAuth() {
  const panel = $("#authPanel");
  document.body.classList.toggle("is-admin", state.currentUser?.role === "admin");
  if (!state.currentUser) {
    panel.innerHTML = state.authProviders.map((provider) => `
      <button data-signin="${provider.id}">${translate(provider.id === "microsoft" ? "signInMicrosoft" : "signInGoogle")}</button>
    `).join("");
    return;
  }
  const role = state.currentUser.role === "admin" ? translate("roleAdmin") : translate("roleUser");
  panel.innerHTML = `
    <div class="user-chip"><strong>${state.currentUser.username}</strong><span>${state.currentUser.auth_provider} - ${role}</span></div>
    <button id="signOutButton">${translate("signOut")}</button>
  `;
}

function renderArticleList() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const articles = state.articles.filter((article) =>
    [article.title, article.summary, article.category, article.tags.join(" ")].join(" ").toLowerCase().includes(query)
  );
  $("#articleList").innerHTML = articles.map((article) => `
    <button class="article-row ${article.id === state.selectedArticleId ? "active" : ""}" data-select-article="${article.id}">
      <strong>${article.title}</strong><span>${article.category} - ${article.tags.join(", ")}</span>
    </button>
  `).join("") || `<p class="empty-state">${translate("noArticleMatches")}</p>`;
}

async function selectArticle(id) {
  const result = await MarknestApi.request(`/api/articles/${id}`);
  const index = state.articles.findIndex((article) => article.id === id);
  if (index >= 0) state.articles[index] = result.article;
  state.selectedArticleId = id;
  await renderArticleDetail();
  renderArticleList();
}

async function renderArticleDetail() {
  const article = state.articles.find((item) => item.id === state.selectedArticleId);
  const detail = $("#articleDetail");
  if (!article) {
    detail.innerHTML = `<p class="empty-state">${translate("selectArticle")}</p>`;
    return;
  }
  let comments = [];
  try {
    comments = (await MarknestApi.request(`/api/articles/${article.id}/comments`)).comments;
  } catch (error) {
    console.error(error);
  }
  detail.innerHTML = `
    <div class="article-meta">${article.author_name} - ${article.category} - ${article.tags.join(", ")} - ${article.published_at || translate("draft")}</div>
    <h2>${article.title}</h2><p>${article.summary}</p>
    <div class="markdown-body">${MarknestMarkdown.renderMarkdown(article.markdown_content)}</div>
    <div class="article-actions">
      <button data-like="${article.id}">${translate("like")} ${article.like_count}</button>
      <button data-share="${article.id}" data-platform="copy">${translate("copyLink")}</button>
      <button data-share="${article.id}" data-platform="wechat">${translate("wechat")}</button>
      <button data-share="${article.id}" data-platform="xiaohongshu">${translate("xiaohongshu")}</button>
      ${canEdit(article) ? `<button data-edit="${article.id}">${translate("edit")}</button>` : ""}
    </div>
    <div class="share-box" id="shareBox"></div>
    <div class="comments-box"><h3>${translate("comments")}</h3>
      ${comments.map((comment) => `<div class="comment"><strong>${comment.author_name}</strong><p>${comment.content}</p>${state.currentUser && (state.currentUser.role === "admin" || state.currentUser.id === comment.user_id) ? `<button class="danger" data-delete-comment="${comment.id}">Delete</button>` : ""}</div>`).join("")}
      <form id="commentForm"><input id="commentInput" placeholder="${translate("addComment")}" /></form>
    </div>
  `;
}

function resetEditor() {
  state.editingArticleId = null;
  $("#titleInput").value = "";
  $("#summaryInput").value = "";
  $("#categoryInput").value = "";
  $("#tagsInput").value = "";
  $("#markdownInput").value = `# ${translate("untitled")}\n\n${translate("startWriting")}`;
  $("#draftStatus").textContent = translate("draft");
  updatePreview();
}

async function editArticle(id) {
  const article = (await MarknestApi.request(`/api/articles/${id}`)).article;
  state.editingArticleId = id;
  $("#titleInput").value = article.title;
  $("#summaryInput").value = article.summary;
  $("#categoryInput").value = article.category;
  $("#tagsInput").value = article.tags.join(", ");
  $("#markdownInput").value = article.markdown_content;
  $("#draftStatus").textContent = article.status === "published" ? translate("published") : translate("draft");
  updatePreview();
  showView("workspace");
}

function articlePayload() {
  return {
    title: $("#titleInput").value.trim() || translate("untitled"),
    summary: $("#summaryInput").value.trim() || translate("noSummary"),
    category: $("#categoryInput").value.trim() || translate("general"),
    tags: $("#tagsInput").value.split(",").map((tag) => tag.trim()).filter(Boolean),
    markdown_content: $("#markdownInput").value,
    visibility: "public"
  };
}

async function saveArticle(status) {
  if (!requireUser()) return;
  let article;
  if (state.editingArticleId) {
    article = (await MarknestApi.request(`/api/articles/${state.editingArticleId}`, {
      method: "PUT", body: JSON.stringify(articlePayload())
    })).article;
  } else {
    article = (await MarknestApi.request("/api/articles", {
      method: "POST", body: JSON.stringify({ ...articlePayload(), status: "draft" })
    })).article;
    state.editingArticleId = article.id;
  }
  if (status === "published" && article.status !== "published") {
    article = (await MarknestApi.request(`/api/articles/${article.id}/publish`, { method: "POST" })).article;
  }
  $("#draftStatus").textContent = status === "published" ? translate("published") : translate("draft");
  $("#autosaveStatus").textContent = `${translate("saved")} ${new Date().toLocaleTimeString()}`;
  await loadArticles();
  if (status === "published") state.selectedArticleId = article.id;
  render();
}

function updatePreview() {
  $("#previewOutput").innerHTML = MarknestMarkdown.renderMarkdown($("#markdownInput").value);
  $("#autosaveStatus").textContent = translate("editing");
}

function uploadMarkdown(file) {
  if (!requireUser() || !file) return;
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

function renderStats() {
  const totals = state.articles.reduce((sum, article) => ({
    views: sum.views + article.view_count,
    likes: sum.likes + article.like_count,
    comments: sum.comments + article.comment_count,
    shares: sum.shares + article.share_count
  }), { views: 0, likes: 0, comments: 0, shares: 0 });
  const labels = { views: "metricViews", likes: "metricLikes", comments: "metricComments", shares: "metricShares" };
  $("#statsGrid").innerHTML = Object.entries(totals).map(([key, value]) =>
    `<div class="stat-card"><span class="metric-label">${translate(labels[key])}</span><span class="metric-value">${value}</span></div>`
  ).join("");
}

async function renderAdmin() {
  if (state.currentUser?.role !== "admin") return;
  try {
    const [data, usersResult, articlesResult, commentsResult] = await Promise.all([
      MarknestApi.request("/api/admin/dashboard"),
      MarknestApi.request("/api/admin/users"),
      MarknestApi.request("/api/admin/articles"),
      MarknestApi.request("/api/admin/comments")
    ]);
    const metrics = Object.entries(data).map(([key, value]) =>
      `<div class="admin-card"><span class="metric-label">${key}</span><span class="metric-value">${value}</span></div>`
    ).join("");
    const users = usersResult.users.map((user) => `
      <li><strong>${user.username}</strong> (${user.role}, ${user.status})
        <button data-admin-user="${user.id}" data-role="${user.role === "admin" ? "user" : "admin"}">${translate(user.role === "admin" ? "makeUser" : "makeAdmin")}</button>
        <button data-admin-user="${user.id}" data-status="${user.status === "active" ? "disabled" : "active"}">${translate(user.status === "active" ? "disable" : "enable")}</button>
      </li>`).join("");
    const articles = articlesResult.articles.map((article) => `
      <li><strong>${article.title}</strong> (${article.status})
        <button data-admin-article="${article.id}" data-status="${article.status === "published" ? "unlisted" : "published"}">${translate(article.status === "published" ? "unlist" : "restore")}</button>
      </li>`).join("");
    const comments = commentsResult.comments.map((comment) => `
      <li>${comment.content}
        <button class="danger" data-delete-comment="${comment.id}" data-admin-refresh="true">${translate("delete")}</button>
      </li>`).join("");
    $("#adminGrid").innerHTML = `${metrics}
      <div class="admin-card admin-wide"><h3>${translate("userManagement")}</h3><ul>${users}</ul></div>
      <div class="admin-card admin-wide"><h3>${translate("articleManagement")}</h3><ul>${articles}</ul></div>
      <div class="admin-card admin-wide"><h3>${translate("commentManagement")}</h3><ul>${comments}</ul></div>`;
  } catch (error) {
    showError(error);
  }
}

function showView(name) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}View`));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  if (name === "admin") renderAdmin();
}

async function render() {
  renderStaticTranslations();
  renderAuth();
  renderArticleList();
  await renderArticleDetail();
  renderStats();
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    try {
      if (target.dataset.signin) await signIn(target.dataset.signin);
      else if (target.id === "signOutButton") await signOut();
      else if (target.dataset.view) showView(target.dataset.view);
      else if (target.dataset.selectArticle) await selectArticle(target.dataset.selectArticle);
      else if (target.dataset.edit) await editArticle(target.dataset.edit);
      else if (target.dataset.like) {
        await MarknestApi.request(`/api/articles/${target.dataset.like}/like`, { method: "POST" });
        await loadArticles();
        await render();
      } else if (target.dataset.share) {
        const share = await MarknestApi.request(`/api/articles/${target.dataset.share}/share`, {
          method: "POST", body: JSON.stringify({ platform: target.dataset.platform })
        });
        navigator.clipboard?.writeText(share.text);
        $("#shareBox").innerHTML = `<p>${share.text.replace(/\n/g, "<br>")}</p>`;
      } else if (target.dataset.deleteComment) {
        await MarknestApi.request(`/api/comments/${target.dataset.deleteComment}`, { method: "DELETE" });
        if (target.dataset.adminRefresh) await renderAdmin();
        else await renderArticleDetail();
      } else if (target.dataset.adminUser) {
        const body = target.dataset.role ? { role: target.dataset.role } : { status: target.dataset.status };
        await MarknestApi.request(`/api/admin/users/${target.dataset.adminUser}`, {
          method: "PUT", body: JSON.stringify(body)
        });
        await renderAdmin();
      } else if (target.dataset.adminArticle) {
        await MarknestApi.request(`/api/admin/articles/${target.dataset.adminArticle}/status`, {
          method: "PUT", body: JSON.stringify({ status: target.dataset.status })
        });
        await loadArticles();
        await renderAdmin();
      }
    } catch (error) {
      showError(error);
    }
  });

  $("#newArticleButton").addEventListener("click", () => requireUser() && resetEditor());
  $("#saveDraftButton").addEventListener("click", () => saveArticle("draft").catch(showError));
  $("#publishButton").addEventListener("click", () => saveArticle("published").catch(showError));
  $("#markdownInput").addEventListener("input", updatePreview);
  $("#markdownFile").addEventListener("change", (event) => uploadMarkdown(event.target.files[0]));
  $("#localeSelect").addEventListener("change", (event) => setLocale(event.target.value));
  $("#searchInput").addEventListener("input", renderArticleList);
  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "commentForm") return;
    event.preventDefault();
    if (!requireUser()) return;
    const input = $("#commentInput");
    if (!input.value.trim()) return;
    try {
      await MarknestApi.request(`/api/articles/${state.selectedArticleId}/comments`, {
        method: "POST", body: JSON.stringify({ content: input.value.trim() })
      });
      input.value = "";
      await loadArticles();
      await render();
    } catch (error) {
      showError(error);
    }
  });
}

async function initialize() {
  bindEvents();
  try {
    await loadAuthProviders();
    await refreshSession();
    await loadArticles();
  } catch (error) {
    showError(error);
  }
  await render();
  resetEditor();
  showView("reader");
}

initialize();

const state = {
  currentUser: null,
  authProviders: [],
  articles: [],
  myArticles: [],
  selectedArticleId: null,
  editingArticleId: null,
  locale: MarknestI18n.normalizeLocale(localStorage.getItem("marknest-locale") || navigator.language)
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
let t = MarknestI18n.createTranslator(state.locale);
let autosaveTimer = null;
let isSaving = false;

function translate(key) {
  return t(key);
}

function escapeHtml(value) {
  return MarknestMarkdown.escapeHtml(value == null ? "" : String(value));
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
  state.currentUser = result.authenticated ? result.user : null;
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

async function loadMyArticles() {
  state.myArticles = state.currentUser
    ? (await MarknestApi.request("/api/articles?mine=true")).articles
    : [];
}

async function signIn(provider) {
  if (!MarknestApi.signIn(provider)) return;
  await refreshSession();
  await loadArticles();
  await loadMyArticles();
  render();
}

async function signOut() {
  if (!MarknestApi.signOut()) return;
  state.currentUser = null;
  state.myArticles = [];
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
    <div class="user-chip">
      <strong>${escapeHtml(state.currentUser.username)}</strong>
      <span>${escapeHtml(state.currentUser.email || state.currentUser.auth_provider)} - ${escapeHtml(role)}</span>
    </div>
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
      <strong>${escapeHtml(article.title)}</strong><span>${escapeHtml(article.category)} - ${escapeHtml(article.tags.join(", "))}</span>
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
  const headings = MarknestMarkdown.extractHeadings(article.markdown_content).filter((heading) => heading.level <= 3);
  const toc = headings.length > 1 ? `<nav class="article-toc"><strong>${translate("tableOfContents")}</strong>${headings.map((heading) =>
    `<a href="#${heading.id}" style="padding-left:${(heading.level - 1) * 12}px">${escapeHtml(heading.text)}</a>`).join("")}</nav>` : "";
  detail.innerHTML = `
    <div class="article-meta">${escapeHtml(article.author_name)} - ${escapeHtml(article.category)} - ${escapeHtml(article.tags.join(", "))} - ${escapeHtml(article.published_at || translate("draft"))}</div>
    <h2>${escapeHtml(article.title)}</h2><p>${escapeHtml(article.summary)}</p>
    ${toc}
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
      ${comments.map((comment) => `<div class="comment"><strong>${escapeHtml(comment.author_name)}</strong><p>${escapeHtml(comment.content)}</p>${state.currentUser && (state.currentUser.role === "admin" || state.currentUser.id === comment.user_id) ? `<button class="danger" data-delete-comment="${comment.id}">${translate("delete")}</button>` : ""}</div>`).join("")}
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
  $("#visibilityInput").value = "public";
  $("#coverInput").value = "";
  $("#uploadWarnings").hidden = true;
  $("#markdownInput").value = `# ${translate("untitled")}\n\n${translate("startWriting")}`;
  $("#draftStatus").textContent = translate("draft");
  updatePreview(false);
}

async function editArticle(id) {
  const article = (await MarknestApi.request(`/api/articles/${id}`)).article;
  state.editingArticleId = id;
  $("#titleInput").value = article.title;
  $("#summaryInput").value = article.summary;
  $("#categoryInput").value = article.category;
  $("#tagsInput").value = article.tags.join(", ");
  $("#visibilityInput").value = article.visibility;
  $("#coverInput").value = article.cover_image_url || "";
  $("#markdownInput").value = article.markdown_content;
  $("#draftStatus").textContent = article.status === "published" ? translate("published") : translate("draft");
  updatePreview(false);
  showView("workspace");
}

function articlePayload() {
  return {
    title: $("#titleInput").value.trim() || translate("untitled"),
    summary: $("#summaryInput").value.trim() || translate("noSummary"),
    category: $("#categoryInput").value.trim() || translate("general"),
    tags: $("#tagsInput").value.split(",").map((tag) => tag.trim()).filter(Boolean),
    markdown_content: $("#markdownInput").value,
    visibility: $("#visibilityInput").value,
    cover_image_url: $("#coverInput").value.trim() || null
  };
}

async function saveArticle(status, options = {}) {
  if (!requireUser()) return;
  if (isSaving) return;
  isSaving = true;
  let article;
  try {
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
    $("#draftStatus").textContent = article.status === "published" ? translate("published") : translate("draft");
    $("#autosaveStatus").textContent = `${translate("saved")} ${new Date().toLocaleTimeString()}`;
    await Promise.all([loadArticles(), loadMyArticles()]);
    if (status === "published") state.selectedArticleId = article.id;
    if (!options.silent) await render();
    else renderWorkspaceArticles();
    return article;
  } finally {
    isSaving = false;
  }
}

function updatePreview(scheduleAutosave = true) {
  $("#previewOutput").innerHTML = MarknestMarkdown.renderMarkdown($("#markdownInput").value);
  $("#autosaveStatus").textContent = translate("editing");
  if (!scheduleAutosave) return;
  clearTimeout(autosaveTimer);
  localStorage.setItem("marknest-local-draft", JSON.stringify(articlePayload()));
  if (state.currentUser) {
    autosaveTimer = setTimeout(() => {
      saveArticle("draft", { silent: true }).catch((error) => {
        console.error(error);
        $("#autosaveStatus").textContent = translate("autosaveFailed");
      });
    }, 1200);
  }
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
    $("#tagsInput").value = Array.isArray(parsed.attributes.tags) ? parsed.attributes.tags.join(", ") : parsed.attributes.tags || "";
    $("#markdownInput").value = parsed.body;
    state.editingArticleId = null;
    const localImages = MarknestMarkdown.findLocalImages(parsed.body);
    const warnings = $("#uploadWarnings");
    warnings.hidden = localImages.length === 0;
    warnings.textContent = localImages.length
      ? `${translate("localImagesWarning")} ${localImages.map((image) => image.path).join(", ")}`
      : "";
    updatePreview();
  };
  reader.readAsText(file);
}

function renderWorkspaceArticles() {
  const container = $("#workspaceArticles");
  if (!state.currentUser) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = state.myArticles.map((article) => `
    <button data-edit="${article.id}" class="${article.id === state.editingArticleId ? "active" : ""}">
      <strong>${escapeHtml(article.title)}</strong>
      <small>${escapeHtml(article.status)} · ${new Date(article.updated_at).toLocaleString()}</small>
    </button>
  `).join("") || `<span class="empty-state">${translate("noArticlesYet")}</span>`;
}

async function unpublishArticle() {
  if (!state.editingArticleId) return;
  await MarknestApi.request(`/api/articles/${state.editingArticleId}/unpublish`, { method: "POST" });
  await Promise.all([loadArticles(), loadMyArticles()]);
  $("#draftStatus").textContent = translate("draft");
  await render();
}

async function deleteArticle() {
  if (!state.editingArticleId || !confirm(translate("confirmDeleteArticle"))) return;
  await MarknestApi.request(`/api/articles/${state.editingArticleId}`, { method: "DELETE" });
  await Promise.all([loadArticles(), loadMyArticles()]);
  resetEditor();
  await render();
}

function renderStats() {
  const source = state.currentUser ? state.myArticles : state.articles;
  const totals = source.reduce((sum, article) => ({
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
  renderWorkspaceArticles();
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
      else if (target.dataset.copyCode !== undefined) {
        const code = target.parentElement.querySelector("code")?.textContent || "";
        await navigator.clipboard?.writeText(code);
        target.textContent = translate("copiedShareText");
      }
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
  $("#unpublishButton").addEventListener("click", () => unpublishArticle().catch(showError));
  $("#deleteArticleButton").addEventListener("click", () => deleteArticle().catch(showError));
  $("#publishButton").addEventListener("click", () => saveArticle("published").catch(showError));
  $("#articleForm").addEventListener("input", updatePreview);
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
    await loadMyArticles();
  } catch (error) {
    showError(error);
  }
  await render();
  resetEditor();
  showView("reader");
}

initialize();

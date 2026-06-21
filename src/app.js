const state = {
  currentUser: null,
  authProviders: [],
  articles: [],
  myArticles: [],
  assets: [],
  commentsByArticle: {},
  unresolvedImages: [],
  selectedArticleId: null,
  editingArticleId: null,
  readerFilter: "recent",
  workspaceFilter: "recent",
  primaryNavExpanded: localStorage.getItem("marknest-primary-nav-expanded") === "true",
  secondarySidebarCollapsed: localStorage.getItem("marknest-secondary-sidebar-collapsed") === "true",
  locale: MarknestI18n.normalizeLocale(localStorage.getItem("marknest-locale") || navigator.language)
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
let t = MarknestI18n.createTranslator(state.locale);
let autosaveTimer = null;
let isSaving = false;
let activeOperations = 0;
let progressTimer = null;
let pendingDeleteArticleId = null;
let pendingDeleteTimer = null;

function translate(key) {
  return t(key);
}

function escapeHtml(value) {
  return MarknestMarkdown.escapeHtml(value == null ? "" : String(value));
}

function initials(value) {
  return String(value || "M").trim().slice(0, 1).toUpperCase();
}

function showError(error) {
  console.error(error);
  showToast(error.message || translate("unexpectedError"), "error");
}

function showToast(message, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $("#toastStack").append(toast);
  setTimeout(() => toast.remove(), type === "error" ? 6000 : 3200);
}

function clearAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

function closeMoreActions() {
  const menu = $("#moreActionsMenu");
  if (menu) menu.hidden = true;
  const button = $("#moreActionsButton");
  if (button) button.setAttribute("aria-expanded", "false");
}

function closeAccountMenu() {
  const menu = $("#accountMenu");
  if (menu) menu.hidden = true;
  const button = $("#accountMenuButton");
  if (button) button.setAttribute("aria-expanded", "false");
}

function toggleAccountMenu() {
  const menu = $("#accountMenu");
  const button = $("#accountMenuButton");
  if (!menu || !button) return;
  const nextOpen = menu.hidden;
  menu.hidden = !nextOpen;
  button.setAttribute("aria-expanded", String(nextOpen));
}

function toggleMoreActions() {
  const menu = $("#moreActionsMenu");
  const button = $("#moreActionsButton");
  const nextOpen = menu.hidden;
  menu.hidden = !nextOpen;
  button.setAttribute("aria-expanded", String(nextOpen));
}

function stylePresetClass(value) {
  const preset = ["social", "minimal", "technical", "newsletter", "cover"].includes(value) ? value : "social";
  return `article-style-${preset}`;
}

function applyLayoutState() {
  document.body.classList.toggle("primary-nav-expanded", state.primaryNavExpanded);
  document.body.classList.toggle("secondary-sidebar-collapsed", state.secondarySidebarCollapsed);
  const navToggle = $("#togglePrimaryNavButton");
  if (navToggle) {
    navToggle.setAttribute("aria-pressed", String(state.primaryNavExpanded));
    navToggle.querySelector("span").textContent = state.primaryNavExpanded ? translate("collapseNav") : translate("toggleNav");
  }
  const sidebarToggle = $("#toggleSecondarySidebarButton");
  if (sidebarToggle) {
    sidebarToggle.setAttribute("aria-pressed", String(state.secondarySidebarCollapsed));
    sidebarToggle.setAttribute("title", state.secondarySidebarCollapsed ? translate("expandSidebar") : translate("toggleSidebar"));
    sidebarToggle.setAttribute("aria-label", state.secondarySidebarCollapsed ? translate("expandSidebar") : translate("toggleSidebar"));
  }
}

function clearPendingDelete() {
  clearTimeout(pendingDeleteTimer);
  pendingDeleteTimer = null;
  pendingDeleteArticleId = null;
}

function syncArticle(article) {
  if (!article) return;
  const mineIndex = state.myArticles.findIndex((item) => item.id === article.id);
  if (mineIndex >= 0) state.myArticles[mineIndex] = article;
  const publicIndex = state.articles.findIndex((item) => item.id === article.id);
  if (article.status === "published" && article.visibility === "public") {
    if (publicIndex >= 0) state.articles[publicIndex] = article;
    else state.articles.unshift(article);
    state.selectedArticleId = article.id;
  } else if (publicIndex >= 0) {
    state.articles.splice(publicIndex, 1);
    if (state.selectedArticleId === article.id) state.selectedArticleId = state.articles[0]?.id || null;
  }
}

function articlePath(article) {
  return `/articles/${encodeURIComponent(article.slug || article.id)}`;
}

function articleIdentifierFromLocation() {
  const pathMatch = location.pathname.match(/^\/articles\/([^/?#]+)\/?$/);
  if (pathMatch) return decodeURIComponent(pathMatch[1]);
  const hashMatch = location.hash.match(/^#article-(.+)$/);
  return hashMatch ? decodeURIComponent(hashMatch[1]) : null;
}

function setArticleUrl(article, replace = false) {
  if (!article) return;
  const nextUrl = articlePath(article);
  if (location.pathname === nextUrl && !location.hash) return;
  history[replace ? "replaceState" : "pushState"]({ articleId: article.id }, "", nextUrl);
}

function beginOperation(message) {
  activeOperations += 1;
  clearTimeout(progressTimer);
  progressTimer = setTimeout(() => {
    $("#operationProgressText").textContent = message || translate("processing");
    $("#operationProgress").hidden = false;
  }, 180);
}

function endOperation() {
  activeOperations = Math.max(0, activeOperations - 1);
  if (activeOperations) return;
  clearTimeout(progressTimer);
  $("#operationProgress").hidden = true;
}

async function runAction(button, message, action, successMessage) {
  if (button?.dataset.busy === "true") return null;
  const replaceContent = button?.tagName === "BUTTON";
  const originalHtml = button?.innerHTML;
  if (button) {
    button.dataset.busy = "true";
    button.classList.add("is-busy");
    button.setAttribute("aria-busy", "true");
    if (replaceContent) {
      button.disabled = true;
      button.innerHTML = `<span class="button-spinner" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`;
    }
  }
  beginOperation(message);
  try {
    const result = await action();
    if (successMessage && !result?.cancelled) showToast(successMessage);
    return result;
  } catch (error) {
    showError(error);
    return null;
  } finally {
    endOperation();
    if (button) {
      button.classList.remove("is-busy");
      button.removeAttribute("aria-busy");
      delete button.dataset.busy;
      if (replaceContent) {
        button.disabled = false;
        button.innerHTML = originalHtml;
      }
    }
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function setLocale(locale) {
  state.locale = MarknestI18n.normalizeLocale(locale);
  t = MarknestI18n.createTranslator(state.locale);
  localStorage.setItem("marknest-locale", state.locale);
  if (state.currentUser) {
    await MarknestApi.request("/api/users/me/locale", {
      method: "PUT",
      body: JSON.stringify({ locale: state.locale })
    });
  }
  await render();
}

function renderStaticTranslations() {
  document.documentElement.lang = state.locale;
  $$("[data-i18n]").forEach((element) => {
    element.textContent = translate(element.dataset.i18n);
  });
  $$("[data-i18n-placeholder]").forEach((element) => {
    element.placeholder = translate(element.dataset.i18nPlaceholder);
  });
  $$("[data-i18n-title]").forEach((element) => {
    element.title = translate(element.dataset.i18nTitle);
  });
  $$("[data-label-key]").forEach((element) => {
    element.setAttribute("aria-label", translate(element.dataset.labelKey));
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
  state.authProviders = (await MarknestApi.request("/api/auth/providers")).providers || [];
}

async function loadArticles() {
  state.articles = (await MarknestApi.request("/api/articles")).articles || [];
  if (!state.articles.some((article) => article.id === state.selectedArticleId)) {
    state.selectedArticleId = state.articles[0]?.id || null;
  }
}

async function loadMyArticles() {
  state.myArticles = state.currentUser
    ? (await MarknestApi.request("/api/articles?mine=true")).articles || []
    : [];
}

async function loadLinkedArticle() {
  const identifier = articleIdentifierFromLocation();
  if (!identifier) return false;
  const article = (await MarknestApi.request(`/api/articles/${encodeURIComponent(identifier)}`)).article;
  const index = state.articles.findIndex((item) => item.id === article.id);
  if (index >= 0) state.articles[index] = article;
  else state.articles.unshift(article);
  state.readerFilter = "recent";
  await selectArticle(article.id, { skipUrlUpdate: true });
  if (location.hash) setArticleUrl(article, true);
  return true;
}

async function loadArticleAssets() {
  if (!state.currentUser || !state.editingArticleId) {
    state.assets = [];
    state.unresolvedImages = MarknestMarkdown.findLocalImages($("#markdownInput").value);
    renderAssetDrawer();
    return;
  }
  const result = await MarknestApi.request(`/api/articles/${state.editingArticleId}/assets`);
  state.assets = result.assets || [];
  state.unresolvedImages = result.unresolvedImages || [];
  renderAssetDrawer();
}

async function signIn(provider) {
  if (!MarknestApi.signIn(provider)) return;
  await refreshSession();
  await Promise.all([loadArticles(), loadMyArticles()]);
  await render();
}

async function signOut() {
  if (!MarknestApi.signOut()) return;
  state.currentUser = null;
  state.myArticles = [];
  state.assets = [];
  state.unresolvedImages = [];
  await render();
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
  const roleLabel = translate(state.currentUser.role === "admin" ? "roleAdmin" : "roleUser");
  panel.innerHTML = `
    <div class="account-popover">
      <button class="user-chip" id="accountMenuButton" type="button" aria-label="${escapeHtml(translate("accountDetails"))}" aria-expanded="false" aria-controls="accountMenu" title="${escapeHtml(state.currentUser.username)}">
        <strong>${escapeHtml(initials(state.currentUser.username))}</strong>
      </button>
      <div class="account-menu" id="accountMenu" hidden>
        <div class="account-card">
          <span class="account-avatar">${escapeHtml(initials(state.currentUser.username))}</span>
          <div>
            <strong>${escapeHtml(state.currentUser.username)}</strong>
            <span>${escapeHtml(state.currentUser.email || translate("accountEmailMissing"))}</span>
          </div>
        </div>
        <dl>
          <div><dt>${translate("accountProvider")}</dt><dd>${escapeHtml(state.currentUser.auth_provider)}</dd></div>
          <div><dt>${translate("accountRole")}</dt><dd>${escapeHtml(roleLabel)}</dd></div>
          <div><dt>${translate("accountLocale")}</dt><dd>${escapeHtml(state.currentUser.preferred_locale || state.locale)}</dd></div>
        </dl>
        <button id="signOutButton" class="account-signout" type="button">${translate("signOut")}</button>
      </div>
    </div>
  `;
}

function filteredArticles(source) {
  const query = $("#searchInput").value.trim().toLowerCase();
  if (!query) return source;
  return source.filter((article) =>
    [article.title, article.summary, article.category, article.tags.join(" ")].join(" ").toLowerCase().includes(query)
  );
}

function filterByStatus(source, filter) {
  if (filter === "drafts") return source.filter((article) => article.status !== "published");
  if (filter === "published") return source.filter((article) => article.status === "published");
  return source;
}

function renderFilterTabs(scope) {
  const activeFilter = scope === "workspace" ? state.workspaceFilter : state.readerFilter;
  $$(`[data-tab-scope="${scope}"]`).forEach((button) => {
    const active = button.dataset.tabFilter === activeFilter;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
}

function renderArticleList() {
  renderFilterTabs("reader");
  const source = state.readerFilter === "drafts" ? state.myArticles : state.articles;
  const articles = filteredArticles(filterByStatus(source, state.readerFilter));
  if (!articles.some((article) => article.id === state.selectedArticleId)) {
    state.selectedArticleId = null;
  }
  $("#articleList").innerHTML = articles.map((article) => `
    <button class="article-row ${article.id === state.selectedArticleId ? "active" : ""}" data-select-article="${article.id}">
      <strong>${escapeHtml(article.title)}</strong>
      <span>${escapeHtml(article.category)} · ${article.view_count} ${translate("metricViews")}</span>
    </button>
  `).join("") || `<p class="empty-state">${state.readerFilter === "drafts" && !state.currentUser ? translate("signInRequired") : translate("noArticleMatches")}</p>`;
}

async function selectArticle(id, options = {}) {
  state.selectedArticleId = id;
  renderArticleList();
  $("#articleDetail").innerHTML = `<div class="content-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div>`;
  const [articleResult, commentsResult] = await Promise.all([
    MarknestApi.request(`/api/articles/${id}`),
    MarknestApi.request(`/api/articles/${id}/comments`)
  ]);
  const article = articleResult.article;
  const index = state.articles.findIndex((item) => item.id === id);
  if (index >= 0) state.articles[index] = article;
  state.commentsByArticle[id] = commentsResult.comments || [];
  renderArticleDetail();
  renderArticleList();
  if (!options.skipUrlUpdate) setArticleUrl(article);
}

function renderArticleDetail() {
  const article = state.articles.find((item) => item.id === state.selectedArticleId);
  const detail = $("#articleDetail");
  detail.className = `article-detail social-article ${stylePresetClass(article?.style_preset)}`;
  if (!article) {
    detail.innerHTML = `<p class="empty-state">${translate("selectArticle")}</p>`;
    return;
  }
  if (article.markdown_content == null) {
    detail.innerHTML = `<div class="content-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div>`;
    return;
  }
  const comments = state.commentsByArticle[article.id] || [];
  const headings = MarknestMarkdown.extractHeadings(article.markdown_content).filter((heading) => heading.level <= 3);
  const toc = headings.length > 1 ? `<nav class="article-toc"><strong>${translate("tableOfContents")}</strong>${headings.map((heading) =>
    `<a href="#${heading.id}" style="padding-left:${(heading.level - 1) * 12}px">${escapeHtml(heading.text)}</a>`).join("")}</nav>` : "";
  detail.innerHTML = `
    <header class="preview-author">
      <span class="avatar">${escapeHtml(initials(article.author_name))}</span>
      <div><strong>${escapeHtml(article.author_name)}</strong><span>${escapeHtml(article.published_at || translate("draft"))}</span></div>
      <span class="icon-button static-icon" aria-hidden="true">•••</span>
    </header>
    <h2>${escapeHtml(article.title)}</h2>
    <p>${escapeHtml(article.summary)}</p>
    <div class="preview-tags">${article.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
    ${toc}
    <div class="markdown-body">${MarknestMarkdown.renderMarkdown(article.markdown_content)}</div>
    <div class="engagement-bar">
      <span>◉ ${article.view_count} ${translate("metricViews")}</span>
      <span>♡ ${article.like_count} ${translate("metricLikes")}</span>
      <span>□ ${article.comment_count} ${translate("metricComments")}</span>
      <span>↗ ${article.share_count} ${translate("metricShares")}</span>
    </div>
    <div class="article-actions">
      <button data-like="${article.id}">${translate("like")}</button>
      <button data-share="${article.id}" data-platform="copy">${translate("copyLink")}</button>
      <button data-share="${article.id}" data-platform="wechat">${translate("wechat")}</button>
      <button data-share="${article.id}" data-platform="xiaohongshu">${translate("xiaohongshu")}</button>
      ${canEdit(article) ? `<button data-edit="${article.id}">${translate("edit")}</button>` : ""}
    </div>
    <div class="share-box" id="shareBox"></div>
    <div class="comments-box">
      <h3>${translate("comments")}</h3>
      ${comments.map((comment) => `<div class="comment"><strong>${escapeHtml(comment.author_name)}</strong><p>${escapeHtml(comment.content)}</p>${state.currentUser && (state.currentUser.role === "admin" || state.currentUser.id === comment.user_id) ? `<button class="danger" data-delete-comment="${comment.id}">${translate("delete")}</button>` : ""}</div>`).join("")}
      <form id="commentForm"><input id="commentInput" placeholder="${translate("addComment")}" /></form>
    </div>
  `;
}

function resetEditor() {
  state.editingArticleId = null;
  state.assets = [];
  state.unresolvedImages = [];
  $("#titleInput").value = "";
  $("#summaryInput").value = "";
  $("#categoryInput").value = "";
  $("#tagsInput").value = "";
  $("#visibilityInput").value = "public";
  $("#stylePresetInput").value = "social";
  $("#coverInput").value = "";
  $("#markdownInput").value = `# ${translate("untitled")}\n\n${translate("startWriting")}`;
  $("#draftStatus").textContent = translate("draft");
  $("#autosaveStatus").textContent = translate("notSaved");
  updatePreview(false);
  renderWorkspaceArticles();
  renderAssetDrawer();
}

async function editArticle(id) {
  const article = (await MarknestApi.request(`/api/articles/${id}`)).article;
  state.editingArticleId = id;
  $("#titleInput").value = article.title;
  $("#summaryInput").value = article.summary;
  $("#categoryInput").value = article.category;
  $("#tagsInput").value = article.tags.join(", ");
  $("#visibilityInput").value = article.visibility;
  $("#stylePresetInput").value = article.style_preset || "social";
  $("#coverInput").value = article.cover_image_url || "";
  $("#markdownInput").value = article.markdown_content;
  $("#draftStatus").textContent = article.status === "published" ? translate("published") : translate("draft");
  updatePreview(false);
  showView("workspace");
  await loadArticleAssets();
  renderWorkspaceArticles();
}

function articlePayload() {
  return {
    title: $("#titleInput").value.trim() || translate("untitled"),
    summary: $("#summaryInput").value.trim() || translate("noSummary"),
    category: $("#categoryInput").value.trim() || translate("general"),
    tags: $("#tagsInput").value.split(",").map((tag) => tag.trim()).filter(Boolean),
    markdown_content: $("#markdownInput").value,
    visibility: $("#visibilityInput").value,
    style_preset: $("#stylePresetInput").value,
    cover_image_url: $("#coverInput").value.trim() || null
  };
}

async function saveArticle(status, options = {}) {
  if (!requireUser() || isSaving) return null;
  isSaving = true;
  $("#autosaveStatus").textContent = translate("saving");
  try {
    let article;
    if (state.editingArticleId) {
      article = (await MarknestApi.request(`/api/articles/${state.editingArticleId}`, {
        method: "PUT",
        body: JSON.stringify(articlePayload())
      })).article;
    } else {
      article = (await MarknestApi.request("/api/articles", {
        method: "POST",
        body: JSON.stringify(articlePayload())
      })).article;
      state.editingArticleId = article.id;
    }
    if (status === "published" && article.status !== "published") {
      try {
        article = (await MarknestApi.request(`/api/articles/${article.id}/publish`, { method: "POST" })).article;
      } catch (error) {
        if (error.status === 409) {
          state.unresolvedImages = MarknestMarkdown.findLocalImages($("#markdownInput").value);
          renderAssetDrawer(true);
          error.message = translate("publishBlockedImages");
        }
        throw error;
      }
    }
    $("#draftStatus").textContent = article.status === "published" ? translate("published") : translate("draft");
    $("#autosaveStatus").textContent = `${translate("saved")} · ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    await Promise.all([loadArticles(), loadMyArticles()]);
    if (status === "published") {
      state.selectedArticleId = article.id;
      const index = state.articles.findIndex((item) => item.id === article.id);
      if (index >= 0) state.articles[index] = article;
    }
    if (!options.silent) await render();
    else renderWorkspaceArticles();
    return article;
  } finally {
    isSaving = false;
  }
}

function updatePreview(scheduleAutosave = true) {
  const payload = articlePayload();
  $("#previewTitle").textContent = payload.title;
  $("#previewSummary").textContent = payload.summary;
  $("#previewTags").innerHTML = payload.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  $("#previewOutput").innerHTML = MarknestMarkdown.renderMarkdown(payload.markdown_content);
  const previewPanel = $(".preview-panel");
  if (previewPanel) previewPanel.className = `preview-panel social-article ${stylePresetClass(payload.style_preset)}`;
  const words = payload.markdown_content.replace(/[#>*_`\-[\]|]/g, " ").trim().split(/\s+/).filter(Boolean).length;
  $("#wordCount").textContent = `${words.toLocaleString()} ${state.locale === "zh-CN" ? "字" : "words"}`;
  $("#readingTime").textContent = state.locale === "zh-CN"
    ? `约 ${Math.max(1, Math.ceil(words / 300))} 分钟阅读`
    : `About ${Math.max(1, Math.ceil(words / 220))} min read`;
  state.unresolvedImages = MarknestMarkdown.findLocalImages(payload.markdown_content);
  renderAssetDrawer();
  $("#autosaveStatus").textContent = translate("editing");
  if (!scheduleAutosave) return;
  clearTimeout(autosaveTimer);
  localStorage.setItem("marknest-local-draft", JSON.stringify(payload));
  if (state.currentUser) {
    autosaveTimer = setTimeout(() => {
      saveArticle("draft", { silent: true }).catch((error) => {
        console.error(error);
        $("#autosaveStatus").textContent = translate("autosaveFailed");
      });
    }, 1200);
  }
}

async function uploadMarkdown(file) {
  if (!requireUser() || !file) return;
  const markdown = await readFileAsText(file);
  const result = await MarknestApi.request("/api/articles/upload-md", {
    method: "POST",
    body: JSON.stringify({ markdown })
  });
  await Promise.all([loadArticles(), loadMyArticles()]);
  await editArticle(result.article.id);
  state.unresolvedImages = result.localImages || [];
  renderAssetDrawer(state.unresolvedImages.length > 0);
}

function normalizedPath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "").toLowerCase();
}

function matchingSourcePath(file) {
  const relative = normalizedPath(file.webkitRelativePath || file.name);
  const filename = relative.split("/").pop();
  return state.unresolvedImages.find((image) => {
    const candidate = normalizedPath(image.path);
    return candidate === relative || candidate.split("/").pop() === filename;
  })?.path || file.webkitRelativePath || file.name;
}

async function uploadImageFiles(files) {
  if (!requireUser() || !files.length) return;
  if (!state.editingArticleId) {
    const article = await saveArticle("draft", { silent: true });
    if (!article) throw new Error(translate("imageUploadFailed"));
  }
  for (const file of files) {
    const sourcePath = matchingSourcePath(file);
    const result = await MarknestApi.request("/api/assets/images", {
      method: "POST",
      body: JSON.stringify({
        article_id: state.editingArticleId,
        filename: file.name,
        source_path: sourcePath,
        mime_type: file.type,
        data_base64: await readFileAsBase64(file)
      })
    });
    $("#markdownInput").value = result.article.markdown_content;
    state.unresolvedImages = result.unresolvedImages || [];
  }
  await Promise.all([loadMyArticles(), loadArticleAssets()]);
  updatePreview(false);
}

function renderWorkspaceArticles() {
  const container = $("#workspaceArticles");
  renderFilterTabs("workspace");
  if (!state.currentUser) {
    container.innerHTML = `<span class="empty-state">${translate("signInRequired")}</span>`;
    return;
  }
  container.innerHTML = filteredArticles(filterByStatus(state.myArticles, state.workspaceFilter)).map((article) => `
    <button data-edit="${article.id}" class="${article.id === state.editingArticleId ? "active" : ""}">
      <strong>${escapeHtml(article.title)}</strong>
      <small>● ${escapeHtml(article.status)} · ${new Date(article.updated_at).toLocaleDateString()}</small>
    </button>
  `).join("") || `<span class="empty-state">${translate("noArticlesYet")}</span>`;
}

function renderAssetDrawer(forceOpen = false) {
  const drawer = $("#assetDrawer");
  const warnings = $("#uploadWarnings");
  warnings.hidden = state.unresolvedImages.length === 0;
  warnings.innerHTML = state.unresolvedImages.length
    ? `<strong>${translate("unresolvedAssets")}</strong><br>${state.unresolvedImages.map((image) => escapeHtml(image.path)).join("<br>")}`
    : "";
  $("#assetList").innerHTML = state.assets.map((asset) => `
    <div class="asset-item">
      <img src="${escapeHtml(asset.public_url)}" alt="" />
      <div><strong>${escapeHtml(asset.original_filename)}</strong><small>${escapeHtml(asset.source_path || "")}</small></div>
      <button class="danger" data-delete-asset="${asset.id}">${translate("delete")}</button>
    </div>
  `).join("") || `<span class="empty-state">${translate("noImageAssets")}</span>`;
  if (forceOpen) drawer.hidden = false;
}

async function unpublishArticle() {
  if (!state.editingArticleId) return;
  clearAutosave();
  const result = await MarknestApi.request(`/api/articles/${state.editingArticleId}/unpublish`, { method: "POST" });
  syncArticle(result.article);
  await loadMyArticles();
  $("#draftStatus").textContent = translate("draft");
  renderArticleList();
  renderWorkspaceArticles();
  renderStats();
  renderArticleDetail();
  closeMoreActions();
  await loadArticleAssets();
  return result.article;
}

function removeArticleFromState(articleId) {
  state.articles = state.articles.filter((article) => article.id !== articleId);
  state.myArticles = state.myArticles.filter((article) => article.id !== articleId);
  if (state.selectedArticleId === articleId) state.selectedArticleId = state.articles[0]?.id || null;
}

async function deleteArticle() {
  if (!state.editingArticleId) return null;
  const articleId = state.editingArticleId;
  if (pendingDeleteArticleId !== articleId) {
    clearPendingDelete();
    pendingDeleteArticleId = articleId;
    pendingDeleteTimer = setTimeout(clearPendingDelete, 7000);
    showToast(translate("deleteConfirmPrompt"), "error");
    return { cancelled: true };
  }
  clearPendingDelete();
  clearAutosave();
  await MarknestApi.request(`/api/articles/${articleId}`, { method: "DELETE" });
  removeArticleFromState(articleId);
  resetEditor();
  renderArticleList();
  renderStats();
  renderArticleDetail();
  closeMoreActions();
  return { deleted: true };
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
  const [data, usersResult, articlesResult, commentsResult] = await Promise.all([
    MarknestApi.request("/api/admin/dashboard"),
    MarknestApi.request("/api/admin/users"),
    MarknestApi.request("/api/admin/articles"),
    MarknestApi.request("/api/admin/comments")
  ]);
  const metrics = Object.entries(data).map(([key, value]) =>
    `<div class="admin-card"><span class="metric-label">${escapeHtml(key)}</span><span class="metric-value">${value}</span></div>`
  ).join("");
  const users = usersResult.users.map((user) => `
    <li><strong>${escapeHtml(user.username)}</strong> (${escapeHtml(user.role)}, ${escapeHtml(user.status)})
      <button data-admin-user="${user.id}" data-role="${user.role === "admin" ? "user" : "admin"}">${translate(user.role === "admin" ? "makeUser" : "makeAdmin")}</button>
      <button data-admin-user="${user.id}" data-status="${user.status === "active" ? "disabled" : "active"}">${translate(user.status === "active" ? "disable" : "enable")}</button>
    </li>`).join("");
  const articles = articlesResult.articles.map((article) => `
    <li><strong>${escapeHtml(article.title)}</strong> (${escapeHtml(article.status)})
      <button data-admin-article="${article.id}" data-status="${article.status === "published" ? "unlisted" : "published"}">${translate(article.status === "published" ? "unlist" : "restore")}</button>
    </li>`).join("");
  const comments = commentsResult.comments.map((comment) => `
    <li>${escapeHtml(comment.content)} <button class="danger" data-delete-comment="${comment.id}" data-admin-refresh="true">${translate("delete")}</button></li>`
  ).join("");
  $("#adminGrid").innerHTML = `${metrics}
    <div class="admin-card admin-wide"><h3>${translate("userManagement")}</h3><ul>${users}</ul></div>
    <div class="admin-card admin-wide"><h3>${translate("articleManagement")}</h3><ul>${articles}</ul></div>
    <div class="admin-card admin-wide"><h3>${translate("commentManagement")}</h3><ul>${comments}</ul></div>`;
}

function showView(name) {
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === `${name}View`));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
}

async function render() {
  renderStaticTranslations();
  applyLayoutState();
  renderAuth();
  renderArticleList();
  renderWorkspaceArticles();
  renderArticleDetail();
  renderStats();
  updatePreview(false);
  if (state.editingArticleId) loadArticleAssets().catch(showError);
}

function insertAtSelection(text, wrap = false) {
  const editor = $("#markdownInput");
  const start = editor.selectionStart;
  const end = editor.selectionEnd;
  const selected = editor.value.slice(start, end);
  editor.value = `${editor.value.slice(0, start)}${text}${selected}${wrap ? text : ""}${editor.value.slice(end)}`;
  const cursor = start + text.length + selected.length + (wrap ? text.length : 0);
  editor.setSelectionRange(cursor, cursor);
  editor.focus();
  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function bindEvents() {
  document.addEventListener("click", async (event) => {
    if (!event.target.closest("#moreActionsMenu") && !event.target.closest("#moreActionsButton")) {
      closeMoreActions();
    }
    if (!event.target.closest("#accountMenu") && !event.target.closest("#accountMenuButton")) {
      closeAccountMenu();
    }
    const target = event.target.closest("button");
    if (!target) return;
    try {
      if (target.dataset.signin) {
        await runAction(target, translate("processing"), () => signIn(target.dataset.signin));
      } else if (target.id === "accountMenuButton") {
        toggleAccountMenu();
      } else if (target.id === "signOutButton") {
        await runAction(target, translate("processing"), signOut);
      } else if (target.dataset.tabScope) {
        closeMoreActions();
        closeAccountMenu();
        if (target.dataset.tabScope === "workspace") {
          state.workspaceFilter = target.dataset.tabFilter || "recent";
          renderWorkspaceArticles();
        } else {
          state.readerFilter = target.dataset.tabFilter || "recent";
          renderArticleList();
          renderArticleDetail();
        }
      } else if (target.dataset.view) {
        closeMoreActions();
        closeAccountMenu();
        showView(target.dataset.view);
        if (target.dataset.view === "admin") {
          await runAction(target, translate("loadingAdmin"), renderAdmin);
        }
      } else if (target.dataset.selectArticle) {
        await runAction(target, translate("loadingArticle"), () => selectArticle(target.dataset.selectArticle));
      } else if (target.dataset.edit) {
        await runAction(target, translate("loadingArticle"), () => editArticle(target.dataset.edit));
      }
      else if (target.dataset.insert) insertAtSelection(target.dataset.insert);
      else if (target.dataset.wrap) insertAtSelection(target.dataset.wrap, true);
      else if (target.dataset.copyCode !== undefined) {
        await navigator.clipboard?.writeText(target.parentElement.querySelector("code")?.textContent || "");
        target.textContent = translate("copiedShareText");
      } else if (target.dataset.like) {
        await runAction(target, translate("updating"), async () => {
          const article = (await MarknestApi.request(`/api/articles/${target.dataset.like}/like`, { method: "POST" })).article;
          const index = state.articles.findIndex((item) => item.id === article.id);
          if (index >= 0) state.articles[index] = article;
          renderArticleDetail();
          renderArticleList();
        }, translate("updateSuccess"));
      } else if (target.dataset.share) {
        await runAction(target, translate("processing"), async () => {
          const share = await MarknestApi.request(`/api/articles/${target.dataset.share}/share`, {
            method: "POST",
            body: JSON.stringify({ platform: target.dataset.platform })
          });
          await navigator.clipboard?.writeText(share.text);
          $("#shareBox").innerHTML = `<p>${escapeHtml(share.text).replace(/\n/g, "<br>")}</p>`;
        }, translate("copiedShareText"));
      } else if (target.dataset.deleteComment) {
        await runAction(target, translate("updating"), async () => {
          await MarknestApi.request(`/api/comments/${target.dataset.deleteComment}`, { method: "DELETE" });
          if (target.dataset.adminRefresh) {
            await renderAdmin();
          } else {
            const comments = state.commentsByArticle[state.selectedArticleId] || [];
            state.commentsByArticle[state.selectedArticleId] = comments.filter((comment) => comment.id !== target.dataset.deleteComment);
            const article = state.articles.find((item) => item.id === state.selectedArticleId);
            if (article) article.comment_count = Math.max(0, article.comment_count - 1);
            renderArticleDetail();
          }
        }, translate("updateSuccess"));
      } else if (target.dataset.deleteAsset) {
        await runAction(target, translate("updating"), async () => {
          await MarknestApi.request(`/api/assets/${target.dataset.deleteAsset}`, { method: "DELETE" });
          const article = (await MarknestApi.request(`/api/articles/${state.editingArticleId}`)).article;
          $("#markdownInput").value = article.markdown_content;
          updatePreview(false);
          await loadArticleAssets();
        }, translate("updateSuccess"));
      } else if (target.dataset.adminUser) {
        await runAction(target, translate("updating"), async () => {
          const body = target.dataset.role ? { role: target.dataset.role } : { status: target.dataset.status };
          await MarknestApi.request(`/api/admin/users/${target.dataset.adminUser}`, { method: "PUT", body: JSON.stringify(body) });
          await renderAdmin();
        }, translate("updateSuccess"));
      } else if (target.dataset.adminArticle) {
        await runAction(target, translate("updating"), async () => {
          await MarknestApi.request(`/api/admin/articles/${target.dataset.adminArticle}/status`, {
            method: "PUT",
            body: JSON.stringify({ status: target.dataset.status })
          });
          await Promise.all([loadArticles(), renderAdmin()]);
        }, translate("updateSuccess"));
      }
    } catch (error) {
      showError(error);
    }
  });

  $("#quickCreateButton").addEventListener("click", () => {
    if (!requireUser()) return;
    resetEditor();
    showView("workspace");
  });
  $("#togglePrimaryNavButton").addEventListener("click", () => {
    state.primaryNavExpanded = !state.primaryNavExpanded;
    localStorage.setItem("marknest-primary-nav-expanded", String(state.primaryNavExpanded));
    applyLayoutState();
  });
  $("#toggleSecondarySidebarButton").addEventListener("click", () => {
    state.secondarySidebarCollapsed = !state.secondarySidebarCollapsed;
    localStorage.setItem("marknest-secondary-sidebar-collapsed", String(state.secondarySidebarCollapsed));
    applyLayoutState();
  });
  $("#newArticleButton").addEventListener("click", () => requireUser() && resetEditor());
  $("#saveDraftButton").addEventListener("click", (event) =>
    runAction(event.currentTarget, translate("savingDraft"), () => saveArticle("draft"), translate("savedSuccess")));
  $("#publishButton").addEventListener("click", (event) =>
    runAction(event.currentTarget, translate("publishingArticle"), () => saveArticle("published"), translate("publishedSuccess")));
  $("#unpublishButton").addEventListener("click", (event) =>
    runAction(event.currentTarget, translate("updating"), unpublishArticle, translate("updateSuccess")));
  $("#deleteArticleButton").addEventListener("click", (event) =>
    runAction(event.currentTarget, translate("updating"), deleteArticle, translate("updateSuccess")));
  $("#moreActionsButton").addEventListener("click", () => {
    toggleMoreActions();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeMoreActions();
      closeAccountMenu();
    }
  });
  $("#insertImageButton").addEventListener("click", () => {
    $("#assetDrawer").hidden = !$("#assetDrawer").hidden;
  });
  $("#articleForm").addEventListener("input", () => updatePreview());
  $("#markdownFile").addEventListener("change", (event) => {
    runAction(event.target.closest("label"), translate("uploadingFile"), () => uploadMarkdown(event.target.files[0]), translate("uploadSuccess"));
    event.target.value = "";
  });
  $("#imageFiles").addEventListener("change", (event) => {
    runAction(event.target.closest("label"), translate("uploadingFile"), () => uploadImageFiles(Array.from(event.target.files || [])), translate("uploadSuccess"));
    event.target.value = "";
  });
  $("#localeSelect").addEventListener("change", (event) => setLocale(event.target.value).catch(showError));
  $("#searchInput").addEventListener("input", () => {
    renderArticleList();
    renderWorkspaceArticles();
  });
  document.addEventListener("submit", async (event) => {
    if (event.target.id !== "commentForm") return;
    event.preventDefault();
    if (!requireUser()) return;
    const input = $("#commentInput");
    if (!input.value.trim()) return;
    try {
      await runAction(null, translate("updating"), async () => {
        await MarknestApi.request(`/api/articles/${state.selectedArticleId}/comments`, {
          method: "POST",
          body: JSON.stringify({ content: input.value.trim() })
        });
        state.commentsByArticle[state.selectedArticleId] = (
          await MarknestApi.request(`/api/articles/${state.selectedArticleId}/comments`)
        ).comments || [];
        const article = state.articles.find((item) => item.id === state.selectedArticleId);
        if (article) article.comment_count = state.commentsByArticle[state.selectedArticleId].length;
        renderArticleDetail();
      }, translate("commentSuccess"));
    } catch (error) {
      showError(error);
    }
  });
  window.addEventListener("popstate", () => {
    loadLinkedArticle().then((loaded) => {
      if (!loaded && location.pathname === "/") {
        state.selectedArticleId = state.articles[0]?.id || null;
        renderArticleList();
        renderArticleDetail();
      }
    }).catch(showError);
  });
}

async function initialize() {
  bindEvents();
  resetEditor();
  applyLayoutState();
  render();
  showView("reader");
  beginOperation(translate("processing"));
  try {
    await Promise.all([loadAuthProviders(), refreshSession()]);
    await Promise.all([loadArticles(), loadMyArticles()]);
    render();
    const loadedLinkedArticle = await loadLinkedArticle();
    if (!loadedLinkedArticle && state.selectedArticleId) {
      await selectArticle(state.selectedArticleId);
    }
  } catch (error) {
    showError(error);
  } finally {
    endOperation();
    document.body.classList.remove("app-loading");
  }
}

initialize();

(function (global) {
  const DEFAULT_LOCALE = "zh-CN";
  const SUPPORTED_LOCALES = ["zh-CN", "en-US"];
  const LOCALE_LABELS = { "zh-CN": "简体中文", "en-US": "English" };

  const messages = {
    "zh-CN": {
      navReader: "阅读", navWorkspace: "工作台", navStats: "数据", navAdmin: "管理",
      globalSearchPlaceholder: "搜索文章与草稿", library: "内容库", recent: "最近",
      readerTitle: "已发布文章", noArticleMatches: "没有匹配的文章。", selectArticle: "选择一篇文章开始阅读。",
      newArticle: "新建文章", saveDraft: "保存草稿", publish: "发布", unpublish: "撤回发布", delete: "删除",
      uploadMd: "上传 .md", titlePlaceholder: "文章标题", summaryPlaceholder: "添加一段简洁的文章摘要",
      categoryLabel: "分类", categoryPlaceholder: "工程实践", tagsLabel: "标签", visibilityLabel: "可见性",
      visibilityPublic: "公开", visibilityUnlisted: "仅链接可见", visibilityPrivate: "私有", coverLabel: "封面图",
      markdownLabel: "Markdown", draft: "草稿", published: "已发布", drafts: "草稿",
      editing: "编辑中", saving: "保存中", saved: "已保存", notSaved: "未保存", autosaveFailed: "自动保存失败",
      autosaveEnabled: "自动保存已开启", livePreview: "实时预览", readerMode: "读者视图", justNow: "刚刚", previewCreator: "Marknest 创作者",
      untitled: "未命名文章", startWriting: "从这里开始写作。", noSummary: "暂无摘要。", general: "通用",
      signInMicrosoft: "使用 Microsoft 登录", signInGoogle: "使用 Google 登录", signOut: "退出",
      roleAdmin: "管理员", roleUser: "普通用户", signInRequired: "请先登录后继续。",
      like: "点赞", copyLink: "复制链接", wechat: "微信朋友圈", xiaohongshu: "小红书",
      edit: "编辑", comments: "评论", addComment: "添加评论", tableOfContents: "目录",
      copiedShareText: "已复制", metricViews: "浏览", metricLikes: "点赞", metricComments: "评论", metricShares: "分享",
      statsTitle: "文章数据", statsSubtitle: "追踪内容表现和读者互动。", analytics: "数据分析",
      adminTitle: "管理后台", adminSubtitle: "管理用户、内容与评论。", administration: "平台管理",
      noArticlesYet: "还没有文章", userManagement: "用户管理", articleManagement: "文章管理",
      commentManagement: "评论管理", makeAdmin: "设为管理员", makeUser: "设为普通用户",
      disable: "禁用", enable: "启用", unlist: "下架", restore: "恢复发布",
      confirmDeleteArticle: "确定永久删除这篇文章吗？",
      imageAssets: "文章图片", imageAssetsHelp: "上传 Markdown 引用的本地图片，系统会自动替换引用路径。",
      uploadImages: "上传图片", localImagesWarning: "仍有本地图片引用待处理：",
      imageUploadSuccess: "图片已上传并替换引用", imageUploadFailed: "图片上传失败",
      publishBlockedImages: "发布前请先解决所有本地图片引用。", uploadedAssets: "已上传资源",
      unresolvedAssets: "待处理引用", noImageAssets: "暂无图片资源", languageLabel: "语言"
    },
    "en-US": {
      navReader: "Reader", navWorkspace: "Workspace", navStats: "Stats", navAdmin: "Admin",
      globalSearchPlaceholder: "Search articles and drafts", library: "Library", recent: "Recent",
      readerTitle: "Published articles", noArticleMatches: "No matching articles.", selectArticle: "Select an article to read.",
      newArticle: "New article", saveDraft: "Save draft", publish: "Publish", unpublish: "Unpublish", delete: "Delete",
      uploadMd: "Upload .md", titlePlaceholder: "Article title", summaryPlaceholder: "Add a concise article summary",
      categoryLabel: "Category", categoryPlaceholder: "Engineering", tagsLabel: "Tags", visibilityLabel: "Visibility",
      visibilityPublic: "Public", visibilityUnlisted: "Link only", visibilityPrivate: "Private", coverLabel: "Cover",
      markdownLabel: "Markdown", draft: "Draft", published: "Published", drafts: "Drafts",
      editing: "Editing", saving: "Saving", saved: "Saved", notSaved: "Not saved", autosaveFailed: "Autosave failed",
      autosaveEnabled: "Autosave enabled", livePreview: "Live preview", readerMode: "Reader view", justNow: "Just now", previewCreator: "Marknest creator",
      untitled: "Untitled article", startWriting: "Start writing here.", noSummary: "No summary yet.", general: "General",
      signInMicrosoft: "Sign in with Microsoft", signInGoogle: "Sign in with Google", signOut: "Sign out",
      roleAdmin: "admin", roleUser: "user", signInRequired: "Please sign in to continue.",
      like: "Like", copyLink: "Copy link", wechat: "WeChat Moments", xiaohongshu: "Xiaohongshu",
      edit: "Edit", comments: "Comments", addComment: "Add a comment", tableOfContents: "Contents",
      copiedShareText: "Copied", metricViews: "Views", metricLikes: "Likes", metricComments: "Comments", metricShares: "Shares",
      statsTitle: "Article analytics", statsSubtitle: "Track content performance and reader engagement.", analytics: "Analytics",
      adminTitle: "Administration", adminSubtitle: "Manage users, content, and comments.", administration: "Administration",
      noArticlesYet: "No articles yet", userManagement: "User management", articleManagement: "Article management",
      commentManagement: "Comment management", makeAdmin: "Make admin", makeUser: "Make user",
      disable: "Disable", enable: "Enable", unlist: "Unlist", restore: "Restore",
      confirmDeleteArticle: "Permanently delete this article?",
      imageAssets: "Article images", imageAssetsHelp: "Upload local images referenced by Markdown and paths will be replaced automatically.",
      uploadImages: "Upload images", localImagesWarning: "Local image references still need attention:",
      imageUploadSuccess: "Image uploaded and reference replaced", imageUploadFailed: "Image upload failed",
      publishBlockedImages: "Resolve all local image references before publishing.", uploadedAssets: "Uploaded assets",
      unresolvedAssets: "Unresolved references", noImageAssets: "No image assets", languageLabel: "Language"
    }
  };

  function normalizeLocale(locale) {
    const exact = SUPPORTED_LOCALES.find((item) => item.toLowerCase() === String(locale || "").toLowerCase());
    if (exact) return exact;
    const language = String(locale || "").split("-")[0].toLowerCase();
    if (language === "en") return "en-US";
    return DEFAULT_LOCALE;
  }

  function createTranslator(locale) {
    const normalized = normalizeLocale(locale);
    return (key) => messages[normalized][key] || messages[DEFAULT_LOCALE][key] || key;
  }

  global.MarknestI18n = { DEFAULT_LOCALE, LOCALE_LABELS, SUPPORTED_LOCALES, createTranslator, messages, normalizeLocale };
  if (typeof module !== "undefined") module.exports = global.MarknestI18n;
})(typeof window !== "undefined" ? window : globalThis);

(function (global) {
  const DEFAULT_LOCALE = "zh-CN";
  const SUPPORTED_LOCALES = ["zh-CN", "en-US"];

  const LOCALE_LABELS = {
    "zh-CN": "简体中文",
    "en-US": "English"
  };

  const messages = {
    "zh-CN": {
      appEyebrow: "Markdown Blog 平台",
      navReader: "阅读",
      navWorkspace: "工作台",
      navStats: "数据",
      navAdmin: "管理",
      readerTitle: "已发布文章",
      readerSubtitle: "阅读、点赞、评论并分享已发布的 Markdown 文章。",
      searchPlaceholder: "搜索文章",
      workspaceTitle: "创作工作台",
      workspaceSubtitle: "上传 Markdown，编辑预览，然后发布文章。",
      uploadMd: "上传 .md",
      newArticle: "新建",
      saveDraft: "保存草稿",
      unpublish: "撤回",
      publish: "发布",
      titleLabel: "标题",
      titlePlaceholder: "文章标题",
      summaryLabel: "摘要",
      summaryPlaceholder: "文章简短摘要",
      categoryLabel: "分类",
      categoryPlaceholder: "工程实践",
      tagsLabel: "标签",
      tagsPlaceholder: "markdown, azure, testing",
      visibilityLabel: "可见性",
      visibilityPublic: "公开",
      visibilityUnlisted: "仅链接可见",
      visibilityPrivate: "私有",
      coverLabel: "封面图 URL",
      myArticles: "我的文章",
      localImagesWarning: "检测到本地图片引用，请替换为可公开访问的图片 URL：",
      confirmDeleteArticle: "确定永久删除这篇文章吗？",
      autosaveFailed: "自动保存失败",
      tableOfContents: "目录",
      markdownLabel: "Markdown",
      draft: "草稿",
      notSaved: "未保存",
      editing: "编辑中",
      saved: "已保存",
      statsTitle: "文章数据",
      statsSubtitle: "追踪文章浏览、点赞、评论和分享表现。",
      adminTitle: "管理后台",
      adminSubtitle: "查看全站用户、内容、评论和部署状态。",
      signInMicrosoft: "使用 Microsoft 登录",
      signInGoogle: "使用 Google 登录",
      signOut: "退出",
      languageLabel: "语言",
      roleAdmin: "管理员",
      roleUser: "普通用户",
      signInRequired: "请先使用 Microsoft Account 或 Google Account 登录。",
      noArticleMatches: "没有匹配的已发布文章。",
      selectArticle: "请选择一篇文章阅读。",
      like: "点赞",
      copyLink: "复制链接",
      wechat: "微信朋友圈",
      xiaohongshu: "小红书",
      edit: "编辑",
      comments: "评论",
      addComment: "添加评论",
      untitled: "未命名文章",
      startWriting: "从这里开始写作。",
      noSummary: "暂无摘要。",
      general: "通用",
      copiedShareText: "已复制分享文案",
      wechatShareText: "微信朋友圈分享文案",
      xiaohongshuShareText: "小红书分享文案",
      qrPlaceholder: "二维码占位",
      metricViews: "浏览",
      metricLikes: "点赞",
      metricComments: "评论",
      metricShares: "分享",
      users: "用户",
      published: "已发布",
      drafts: "草稿",
      adminIdentities: "管理员身份",
      topArticle: "热门文章",
      noArticlesYet: "暂无文章",
      deployment: "部署",
      deploymentStatus: "GitHub Actions 已配置。Azure 目标环境待接入。",
      audit: "审计",
      auditStatus: "生产 API 应记录角色变更日志。",
      userManagement: "用户管理",
      articleManagement: "文章管理",
      commentManagement: "评论管理",
      makeAdmin: "设为管理员",
      makeUser: "设为普通用户",
      disable: "禁用",
      enable: "启用",
      unlist: "下架",
      restore: "恢复发布",
      delete: "删除"
    },
    "en-US": {
      appEyebrow: "Markdown Blog Platform",
      navReader: "Reader",
      navWorkspace: "Workspace",
      navStats: "Stats",
      navAdmin: "Admin",
      readerTitle: "Published Articles",
      readerSubtitle: "Read, like, comment, and share published Markdown posts.",
      searchPlaceholder: "Search articles",
      workspaceTitle: "Creator Workspace",
      workspaceSubtitle: "Upload Markdown, edit with preview, and publish your article.",
      uploadMd: "Upload .md",
      newArticle: "New",
      saveDraft: "Save Draft",
      unpublish: "Unpublish",
      publish: "Publish",
      titleLabel: "Title",
      titlePlaceholder: "Article title",
      summaryLabel: "Summary",
      summaryPlaceholder: "Short article summary",
      categoryLabel: "Category",
      categoryPlaceholder: "Engineering",
      tagsLabel: "Tags",
      tagsPlaceholder: "markdown, azure, testing",
      visibilityLabel: "Visibility",
      visibilityPublic: "Public",
      visibilityUnlisted: "Link only",
      visibilityPrivate: "Private",
      coverLabel: "Cover image URL",
      myArticles: "My Articles",
      localImagesWarning: "Local image references found. Replace them with public image URLs:",
      confirmDeleteArticle: "Permanently delete this article?",
      autosaveFailed: "Autosave failed",
      tableOfContents: "Contents",
      markdownLabel: "Markdown",
      draft: "Draft",
      notSaved: "Not saved",
      editing: "Editing",
      saved: "Saved",
      statsTitle: "Article Stats",
      statsSubtitle: "Track views, likes, comments, and shares for your content.",
      adminTitle: "Admin Dashboard",
      adminSubtitle: "Review all users, content, comments, and deployment status.",
      signInMicrosoft: "Sign in with Microsoft",
      signInGoogle: "Sign in with Google",
      signOut: "Sign out",
      languageLabel: "Language",
      roleAdmin: "admin",
      roleUser: "user",
      signInRequired: "Please sign in with Microsoft Account or Google Account first.",
      noArticleMatches: "No published articles match this search.",
      selectArticle: "Select an article to read.",
      like: "Like",
      copyLink: "Copy Link",
      wechat: "WeChat Moments",
      xiaohongshu: "Xiaohongshu",
      edit: "Edit",
      comments: "Comments",
      addComment: "Add a comment",
      untitled: "Untitled",
      startWriting: "Start writing here.",
      noSummary: "No summary yet.",
      general: "General",
      copiedShareText: "Copied share text",
      wechatShareText: "WeChat Moments copy",
      xiaohongshuShareText: "Xiaohongshu copy",
      qrPlaceholder: "QR placeholder",
      metricViews: "views",
      metricLikes: "likes",
      metricComments: "comments",
      metricShares: "shares",
      users: "Users",
      published: "Published",
      drafts: "Drafts",
      adminIdentities: "Admin Identities",
      topArticle: "Top Article",
      noArticlesYet: "No articles yet",
      deployment: "Deployment",
      deploymentStatus: "GitHub Actions configured. Azure target pending.",
      audit: "Audit",
      auditStatus: "Role changes should be logged by the production API.",
      userManagement: "User Management",
      articleManagement: "Article Management",
      commentManagement: "Comment Management",
      makeAdmin: "Make Admin",
      makeUser: "Make User",
      disable: "Disable",
      enable: "Enable",
      unlist: "Unlist",
      restore: "Publish",
      delete: "Delete"
    }
  };

  function normalizeLocale(locale) {
    if (!locale) {
      return DEFAULT_LOCALE;
    }

    const exact = SUPPORTED_LOCALES.find((item) => item.toLowerCase() === String(locale).toLowerCase());
    if (exact) {
      return exact;
    }

    const language = String(locale).split("-")[0].toLowerCase();
    if (language === "zh") {
      return "zh-CN";
    }
    if (language === "en") {
      return "en-US";
    }
    return DEFAULT_LOCALE;
  }

  function createTranslator(locale) {
    const normalized = normalizeLocale(locale);
    return function translate(key) {
      return messages[normalized][key] || messages[DEFAULT_LOCALE][key] || key;
    };
  }

  global.MarknestI18n = {
    DEFAULT_LOCALE,
    LOCALE_LABELS,
    SUPPORTED_LOCALES,
    createTranslator,
    messages,
    normalizeLocale
  };

  if (typeof module !== "undefined") {
    module.exports = global.MarknestI18n;
  }
})(typeof window !== "undefined" ? window : globalThis);

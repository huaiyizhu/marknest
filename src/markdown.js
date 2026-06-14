(function (global) {
  const MarkdownIt = typeof module !== "undefined" && module.exports
    ? require("markdown-it")
    : global.markdownit;

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeUrl(value) {
    const url = String(value || "").trim();
    if (/^(https?:|mailto:|tel:|\/|#)/i.test(url)) return escapeHtml(url);
    if (/^[./][^/]/.test(url)) return escapeHtml(url);
    return "#";
  }

  function slugifyHeading(value, used) {
    const base = String(value)
      .replace(/[`*_~[\]()]/g, "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "") || "section";
    const count = used.get(base) || 0;
    used.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  }

  function createMarkdownRenderer() {
    if (!MarkdownIt) throw new Error("markdown-it is not loaded");

    const md = new MarkdownIt({
      breaks: false,
      html: false,
      linkify: true,
      typographer: false
    });
    const headingIds = new Map();

    md.renderer.rules.heading_open = (tokens, index) => {
      const token = tokens[index];
      const inline = tokens[index + 1];
      const id = slugifyHeading(inline?.content || "section", headingIds);
      token.attrSet("id", id);
      token.meta = { ...(token.meta || {}), id };
      return md.renderer.renderToken(tokens, index, {});
    };

    md.renderer.rules.heading_close = (tokens, index) => {
      const opening = tokens.slice(0, index).reverse().find((token) =>
        token.type === "heading_open" && token.tag === tokens[index].tag);
      const id = opening?.meta?.id || "section";
      return `<a class="heading-anchor" href="#${escapeHtml(id)}" aria-label="Link to this section">#</a></${tokens[index].tag}>\n`;
    };

    md.renderer.rules.fence = (tokens, index) => {
      const token = tokens[index];
      const language = token.info.trim().split(/\s+/)[0];
      const languageClass = language ? ` class="language-${escapeHtml(language)}"` : "";
      return `<pre><button class="copy-code" type="button" data-copy-code>Copy</button><code${languageClass}>${escapeHtml(token.content)}</code></pre>\n`;
    };

    md.renderer.rules.code_block = (tokens, index) =>
      `<pre><button class="copy-code" type="button" data-copy-code>Copy</button><code>${escapeHtml(tokens[index].content)}</code></pre>\n`;

    md.renderer.rules.table_open = () => '<div class="table-scroll"><table>\n';
    md.renderer.rules.table_close = () => "</table></div>\n";

    const defaultLinkOpen = md.renderer.rules.link_open
      || ((tokens, index, options) => md.renderer.renderToken(tokens, index, options));
    md.renderer.rules.link_open = (tokens, index, options, env, self) => {
      const token = tokens[index];
      if (!token.attrGet("href")) token.attrSet("href", "#");
      token.attrSet("target", "_blank");
      token.attrSet("rel", "noopener noreferrer");
      return defaultLinkOpen(tokens, index, options, env, self);
    };

    const defaultImage = md.renderer.rules.image
      || ((tokens, index, options, env, self) => self.renderToken(tokens, index, options));
    md.renderer.rules.image = (tokens, index, options, env, self) => {
      tokens[index].attrSet("loading", "lazy");
      return defaultImage(tokens, index, options, env, self);
    };

    return md;
  }

  function renderMarkdown(markdown) {
    return createMarkdownRenderer()
      .render(String(markdown || ""))
      .replace(/<li>\s*\[([ xX])\]\s+/g, (_, checked) =>
        `<li class="task-item"><input type="checkbox" disabled${checked.toLowerCase() === "x" ? " checked" : ""}> `);
  }

  function inlineMarkdown(value) {
    return createMarkdownRenderer().renderInline(String(value || ""));
  }

  function parseScalar(value) {
    const text = String(value || "").trim();
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
      return text.slice(1, -1);
    }
    if (text.startsWith("[") && text.endsWith("]")) {
      return text.slice(1, -1).split(",").map((item) => parseScalar(item)).filter(Boolean);
    }
    if (/^(true|false)$/i.test(text)) return text.toLowerCase() === "true";
    return text;
  }

  function parseFrontMatter(markdown) {
    const text = String(markdown || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
    if (!text.startsWith("---\n")) return { attributes: {}, body: text };
    const end = text.indexOf("\n---", 4);
    if (end === -1) return { attributes: {}, body: text };

    const attributes = {};
    let arrayKey = null;
    for (const line of text.slice(4, end).split("\n")) {
      const item = line.match(/^\s*-\s+(.+)$/);
      if (item && arrayKey) {
        attributes[arrayKey].push(parseScalar(item[1]));
        continue;
      }
      const field = line.match(/^([\w-]+):\s*(.*)$/);
      if (!field) continue;
      if (!field[2]) {
        attributes[field[1]] = [];
        arrayKey = field[1];
      } else {
        attributes[field[1]] = parseScalar(field[2]);
        arrayKey = null;
      }
    }
    return { attributes, body: text.slice(end + 4).trimStart() };
  }

  function extractHeadings(markdown) {
    const headings = [];
    const used = new Map();
    let inCode = false;
    for (const line of String(markdown || "").replace(/\r\n?/g, "\n").split("\n")) {
      if (/^\s*```/.test(line)) {
        inCode = !inCode;
        continue;
      }
      if (inCode) continue;
      const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (match) headings.push({ level: match[1].length, text: match[2], id: slugifyHeading(match[2], used) });
    }
    return headings;
  }

  function findLocalImages(markdown) {
    const images = [];
    const pattern = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
    let match;
    while ((match = pattern.exec(String(markdown || "")))) {
      if (!/^(https?:|data:|\/)/i.test(match[2])) images.push({ alt: match[1], path: match[2] });
    }
    return images;
  }

  global.MarknestMarkdown = {
    escapeHtml,
    extractHeadings,
    findLocalImages,
    inlineMarkdown,
    parseFrontMatter,
    renderMarkdown,
    safeUrl
  };

  if (typeof module !== "undefined") module.exports = global.MarknestMarkdown;
})(typeof window !== "undefined" ? window : globalThis);

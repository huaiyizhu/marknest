(function (global) {
  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function inlineMarkdown(value) {
    return escapeHtml(value)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");
  }

  function renderMarkdown(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let inCode = false;
    let codeLines = [];
    let inList = false;
    let inQuote = false;

    function closeList() {
      if (inList) {
        html.push("</ul>");
        inList = false;
      }
    }

    function closeQuote() {
      if (inQuote) {
        html.push("</blockquote>");
        inQuote = false;
      }
    }

    function flushCode() {
      html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      codeLines = [];
    }

    for (const line of lines) {
      if (line.trim().startsWith("```")) {
        if (inCode) {
          flushCode();
          inCode = false;
        } else {
          closeList();
          closeQuote();
          inCode = true;
        }
        continue;
      }

      if (inCode) {
        codeLines.push(line);
        continue;
      }

      if (!line.trim()) {
        closeList();
        closeQuote();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        closeList();
        closeQuote();
        const level = heading[1].length;
        html.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
        continue;
      }

      const listItem = line.match(/^\s*[-*]\s+(.+)$/);
      if (listItem) {
        closeQuote();
        if (!inList) {
          html.push("<ul>");
          inList = true;
        }
        html.push(`<li>${inlineMarkdown(listItem[1])}</li>`);
        continue;
      }

      const quote = line.match(/^>\s?(.+)$/);
      if (quote) {
        closeList();
        if (!inQuote) {
          html.push("<blockquote>");
          inQuote = true;
        }
        html.push(`<p>${inlineMarkdown(quote[1])}</p>`);
        continue;
      }

      closeList();
      closeQuote();
      html.push(`<p>${inlineMarkdown(line)}</p>`);
    }

    if (inCode) {
      flushCode();
    }
    closeList();
    closeQuote();
    return html.join("\n");
  }

  function parseFrontMatter(markdown) {
    const text = String(markdown || "");
    if (!text.startsWith("---")) {
      return { attributes: {}, body: text };
    }

    const end = text.indexOf("\n---", 3);
    if (end === -1) {
      return { attributes: {}, body: text };
    }

    const raw = text.slice(3, end).trim();
    const attributes = {};
    for (const line of raw.split("\n")) {
      const separator = line.indexOf(":");
      if (separator > -1) {
        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim();
        attributes[key] = value;
      }
    }

    return {
      attributes,
      body: text.slice(end + 4).trimStart()
    };
  }

  global.MarknestMarkdown = {
    escapeHtml,
    renderMarkdown,
    parseFrontMatter
  };

  if (typeof module !== "undefined") {
    module.exports = global.MarknestMarkdown;
  }
})(typeof window !== "undefined" ? window : globalThis);


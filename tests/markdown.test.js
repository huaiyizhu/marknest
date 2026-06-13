const assert = require("node:assert/strict");
const { renderMarkdown, parseFrontMatter, escapeHtml } = require("../src/markdown");

const parsed = parseFrontMatter(`---
title: Hello
tags: markdown, test
---

# Hello

Body`);

assert.equal(parsed.attributes.title, "Hello");
assert.equal(parsed.attributes.tags, "markdown, test");
assert.match(parsed.body, /^# Hello/);

const html = renderMarkdown(`# Title

This is **bold** and *emphasis* with \`code\`.

- One
- Two

\`\`\`js
console.log("<safe>");
\`\`\`
`);

assert.match(html, /<h1>Title<\/h1>/);
assert.match(html, /<strong>bold<\/strong>/);
assert.match(html, /<em>emphasis<\/em>/);
assert.match(html, /<ul>/);
assert.match(html, /&lt;safe&gt;/);
assert.equal(escapeHtml("<script>"), "&lt;script&gt;");

console.log("Markdown tests passed");


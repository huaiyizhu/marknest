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

assert.match(html, /<h1 id="title">Title/);
assert.match(html, /<strong>bold<\/strong>/);
assert.match(html, /<em>emphasis<\/em>/);
assert.match(html, /<ul>/);
assert.match(html, /&lt;safe&gt;/);
assert.equal(escapeHtml("<script>"), "&lt;script&gt;");
assert.match(renderMarkdown("| A | B |\n| :--- | ---: |\n| one | two |"), /<table>/);
assert.match(renderMarkdown("Column A | Column B\n--- | ---\nAlpha | Beta"), /<td>Alpha<\/td>/);
assert.match(renderMarkdown("| **Name** | Link |\n| --- | --- |\n| Marknest | [site](https://example.com) |"), /<strong>Name<\/strong>/);
assert.match(renderMarkdown("1. First\n2. Second"), /<ol>/);
assert.match(renderMarkdown("- [x] Done"), /type="checkbox" disabled checked/);
assert.doesNotMatch(renderMarkdown("[unsafe](javascript:alert(1))"), /href="javascript:/);
assert.match(renderMarkdown("## Duplicate\n## Duplicate"), /id="duplicate-2"/);

const yamlList = parseFrontMatter("---\ntitle: \"Quoted\"\ntags:\n  - markdown\n  - test\n---\nBody");
assert.equal(yamlList.attributes.title, "Quoted");
assert.deepEqual(yamlList.attributes.tags, ["markdown", "test"]);

console.log("Markdown tests passed");

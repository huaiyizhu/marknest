const assert = require("node:assert/strict");
const {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  createTranslator,
  messages,
  normalizeLocale
} = require("../src/i18n");

assert.equal(DEFAULT_LOCALE, "zh-CN");
assert.deepEqual(SUPPORTED_LOCALES, ["zh-CN", "en-US"]);
assert.equal(normalizeLocale("zh"), "zh-CN");
assert.equal(normalizeLocale("zh-TW"), "zh-CN");
assert.equal(normalizeLocale("en"), "en-US");
assert.equal(normalizeLocale("en-GB"), "en-US");
assert.equal(normalizeLocale("fr-FR"), "zh-CN");

const zh = createTranslator("zh-CN");
const en = createTranslator("en-US");
const fallback = createTranslator("fr-FR");

assert.equal(zh("navWorkspace"), "工作台");
assert.equal(en("navWorkspace"), "Workspace");
assert.equal(fallback("navWorkspace"), "工作台");
assert.equal(en("missingKey"), "missingKey");

for (const locale of SUPPORTED_LOCALES) {
  for (const key of Object.keys(messages[DEFAULT_LOCALE])) {
    assert.ok(messages[locale][key], `${locale} is missing ${key}`);
  }
}

console.log("I18n tests passed");


import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import { markdownItTable } from "markdown-it-table";

export function createMarkdownRenderer() {
  const markdown = new MarkdownIt({
    highlight: (code, lang) => {
      const validLang = !!(lang && hljs.getLanguage(lang));
      const highlighted = validLang
        ? hljs.highlight(code, { language: lang }).value
        : hljs.highlightAuto(code).value;

      return `<pre><code class="hljs ${validLang ? `language-${lang}` : ""}">${highlighted}</code></pre>`;
    },
    html: true,
    linkify: true,
    breaks: true,
    typographer: true,
    tables: true,
  });

  markdown.use(markdownItTable);
  return markdown;
}

/** Keeps only the latest Markdown/HTML pair for each message key. */
export class MessageMarkdownRenderCache {
  constructor({ markdown = createMarkdownRenderer(), maxEntries = 200 } = {}) {
    this.markdown = markdown;
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
    this.cache = new Map();
    this.metrics = {
      markdownParseCalls: 0,
      parsedCharacters: 0,
      cacheHits: 0,
      evictions: 0,
    };
  }

  render(messageId, raw) {
    const key = messageId ?? "__message_without_id__";
    const source = raw || "";
    const cached = this.cache.get(key);

    if (cached?.source === source) {
      this.metrics.cacheHits += 1;
      // Refresh insertion order so the Map also acts as an LRU queue.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.html;
    }

    const html = this.markdown.render(source);
    this.metrics.markdownParseCalls += 1;
    this.metrics.parsedCharacters += source.length;
    this.cache.set(key, { source, html });
    this.#enforceLimit();
    return html;
  }

  #enforceLimit() {
    while (this.cache.size > this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
      this.metrics.evictions += 1;
    }
  }

  prune(activeMessageIds) {
    const activeIds = new Set(activeMessageIds);
    for (const key of this.cache.keys()) {
      if (!activeIds.has(key)) this.cache.delete(key);
    }
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}

export function createMessageMarkdownCache() {
  return new MessageMarkdownRenderCache();
}

import hljs from "highlight.js";
import MarkdownIt from "markdown-it";
import { markdownItTable } from "markdown-it-table";

function createMarkdownIt() {
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

/** Characterization of renderMarkdown(raw) in chatMessage.vue. */
export class LegacyMarkdownRenderer {
  constructor() {
    this.markdown = createMarkdownIt();
    this.metrics = {
      markdownParseCalls: 0,
      parsedCharacters: 0,
    };
  }

  render(_messageId, raw) {
    const source = raw || "";
    this.metrics.markdownParseCalls += 1;
    this.metrics.parsedCharacters += source.length;
    return this.markdown.render(source);
  }
}

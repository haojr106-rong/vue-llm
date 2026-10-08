function createHistoricalMarkdown(index) {
  return `## 历史回答 ${index}

这是第 ${index} 条已经完成的回答，用于模拟虚拟列表可视区域中内容不再变化的历史消息。

- 保留上下文中的关键结论
- 展示 Markdown 列表、表格和代码块
- 验证重复渲染产生的解析开销

| 指标 | 数值 |
| --- | ---: |
| 消息编号 | ${index} |
| 状态 | 已完成 |

\`\`\`javascript
function message${index}(value) {
  return value.map((item) => item + ${index});
}
\`\`\`
`;
}

function createStreamingChunk(index) {
  const paragraph = `\n\n### 增量片段 ${index}\n模型正在补充第 ${index} 段内容，包含 **重点说明**、边界条件和验证步骤。`;

  if (index % 10 !== 0) return paragraph;

  return `${paragraph}\n\n\`\`\`javascript\nconst chunk${index} = ${index};\n\`\`\``;
}

export function createMarkdownRenderFixture({
  visibleMessageCount = 30,
  streamingUpdateCount = 200,
} = {}) {
  const historicalMessages = Array.from(
    { length: visibleMessageCount - 1 },
    (_, index) => ({
      id: `history-${index + 1}`,
      content: createHistoricalMarkdown(index + 1),
    }),
  );

  return {
    visibleMessageCount,
    streamingUpdateCount,
    messages: [
      ...historicalMessages,
      { id: "streaming-assistant", content: "# 流式回答" },
    ],
    streamingChunks: Array.from(
      { length: streamingUpdateCount },
      (_, index) => createStreamingChunk(index + 1),
    ),
  };
}

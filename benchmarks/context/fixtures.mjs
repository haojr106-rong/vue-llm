const USER_TOPICS = [
  "请解释这段前端逻辑，并说明边界条件和可能的异常处理方式。",
  "请比较两种实现方案的时间复杂度、空间复杂度和维护成本。",
  "请根据已有上下文继续排查问题，不要重复已经确认的结论。",
  "请给出可以落地的优化步骤，并说明每一步如何验证效果。",
];

const ASSISTANT_PARAGRAPHS = [
  "我会先结合前文确定问题边界，再分别检查数据流、状态变化和异常路径。",
  "实现时需要保证旧行为不被破坏，同时为关键分支补充可复现的验证条件。",
  "性能指标应在相同输入和相同环境下比较，并区分正确性指标与耗时指标。",
  "最后还要执行构建检查，确认优化没有引入新的运行时错误或状态不一致。",
];

function repeatWithTurn(text, turn, repeatCount) {
  return Array.from(
    { length: repeatCount },
    (_, index) => `${text}（第${turn}轮-${index + 1}）`,
  ).join("\n");
}

export function createConversationFixture(roundCount = 120) {
  const messages = [];

  for (let turn = 1; turn <= roundCount; turn += 1) {
    const topic = USER_TOPICS[(turn - 1) % USER_TOPICS.length];
    const paragraph =
      ASSISTANT_PARAGRAPHS[(turn - 1) % ASSISTANT_PARAGRAPHS.length];

    messages.push({
      role: "user",
      content: `[turn-${turn}-user]\n${repeatWithTurn(topic, turn, 3)}`,
    });
    messages.push({
      role: "assistant",
      content: `[turn-${turn}-assistant]\n${repeatWithTurn(paragraph, turn, 7)}`,
    });
  }

  return {
    roundCount,
    messages,
  };
}

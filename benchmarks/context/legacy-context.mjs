/**
 * Characterization of the current getMessagesForModel behavior after the
 * empty assistant placeholder has been removed by the view: every historical
 * message is sent again without a context budget.
 */
export function selectLegacyContext(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }));
}

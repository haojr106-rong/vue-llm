export const DEFAULT_MAX_TEXT_PREVIEW = 8_000;

export function truncatePreview(
  text = "",
  maxLength = DEFAULT_MAX_TEXT_PREVIEW,
) {
  const trimmed = text.trim();
  const body = trimmed.slice(0, maxLength);
  const note =
    trimmed.length > maxLength
      ? `内容已截断，仅展示前 ${maxLength} 字符`
      : "";

  return { body, note };
}

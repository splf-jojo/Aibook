// The link is stored in message content, so it survives chat reloads without an API change.
export function solutionMessage(content: string, label: string, canvasId: string, solutionId: string) {
  return content.replace(label, `[${label}](aibook://canvas/${encodeURIComponent(canvasId)}/solution/${encodeURIComponent(solutionId)})`);
}

export function parseSolutionMessage(content: string) {
  const match = /\[([^\]\n]+)\]\(aibook:\/\/canvas\/([\w-]+)\/solution\/([\w-]+)\)/.exec(content);
  if (!match) return null;
  return { before: content.slice(0, match.index), label: match[1], canvasId: match[2], solutionId: match[3], after: content.slice(match.index + match[0].length) };
}

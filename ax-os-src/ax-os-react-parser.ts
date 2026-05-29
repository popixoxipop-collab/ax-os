/**
 * AX OS - ReAct Parser
 * Parses <tool_call>...</tool_call> blocks from LLM output.
 * Format:
 *   <tool_call>{"name": "tool_name", "args": {"key": "value"}}</tool_call>
 */

export interface ParsedToolCall {
  readonly name: string;
  readonly args: Record<string, unknown>;
  readonly thought?: string;   // optional reasoning before the call
  readonly raw: string;        // original matched block
}

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;

/** Extract all tool call blocks from LLM output. */
export function parseToolCalls(text: string): ParsedToolCall[] {
  const results: ParsedToolCall[] = [];
  const re = new RegExp(TOOL_CALL_RE.source, "g");
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    try {
      const payload = JSON.parse(match[1].trim()) as Record<string, unknown>;
      results.push({
        name: String(payload.name ?? payload.tool ?? ""),
        args: (payload.args ?? payload.arguments ?? {}) as Record<string, unknown>,
        thought: payload.thought as string | undefined,
        raw: match[0],
      });
    } catch {
      // skip malformed JSON inside the tag
    }
  }
  return results;
}

/** Remove all tool_call blocks, return clean final-answer text. */
export function stripToolCalls(text: string): string {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").trim();
}

/** Format a tool result as an observation message for the next LLM turn. */
export function buildObservation(
  toolName: string,
  result: string,
  success: boolean
): string {
  const header = `Observation [${toolName}]`;
  if (!success) return `${header}: ERROR — ${result}`;
  // Truncate very long results to avoid context explosion
  const MAX = 2000;
  const body = result.length > MAX ? result.slice(0, MAX) + "\n... [truncated]" : result;
  return `${header}:\n${body}`;
}

/** Build the tool-descriptions block injected into the system prompt. */
export function buildToolDescriptions(
  tools: ReadonlyArray<{ name: string; description: string; parameters: Record<string, { type: string; description: string; required: boolean }> }>
): string {
  return tools.map(t => {
    const params = Object.entries(t.parameters)
      .map(([k, p]) => `    ${k} (${p.type}${p.required ? "" : ", optional"}): ${p.description}`)
      .join("\n");
    return `• ${t.name}\n  ${t.description}${params ? "\n" + params : ""}`;
  }).join("\n\n");
}

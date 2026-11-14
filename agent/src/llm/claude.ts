import Anthropic from "@anthropic-ai/sdk";
import type { LlmConfig } from "../config.js";
import type { ChatMessage, ChatModel, ChatResponse, ToolCall } from "./types.js";

type Block = Anthropic.Beta.BetaContentBlock;
type BlockParam = Anthropic.Beta.BetaContentBlockParam;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolParam = Anthropic.Beta.BetaTool;

/** The one call ClaudeClient makes, so tests can pass a stub instead of a network client. */
export type CreateMessage = (body: Anthropic.Beta.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

const MAX_REMEMBERED_TURNS = 500;

/**
 * Claude through the Anthropic API (NEMOTRON_PROVIDER=claude), behind the same ChatModel interface
 * as Nemotron. The rest of the agent speaks OpenAI-style messages; this class translates both ways.
 *
 * Claude's replies can carry thinking blocks, and the API expects them back unchanged on later
 * turns. ChatMessage has no place for them, so each reply's original blocks are remembered here
 * and replayed when the agent sends that assistant turn back.
 */
export class ClaudeClient implements ChatModel {
  readonly name: string;
  private create: CreateMessage;
  private remembered = new Map<string, Block[]>();

  constructor(private cfg: LlmConfig, create?: CreateMessage) {
    this.name = `claude:${cfg.model}`;
    if (create) {
      this.create = create;
    } else {
      // No key in config: the SDK falls back to ANTHROPIC_API_KEY or an `ant auth login` profile.
      const client = new Anthropic({ ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}), timeout: cfg.timeoutMs, maxRetries: 1 });
      this.create = (body) => client.beta.messages.create(body);
    }
  }

  async chat(messages: ChatMessage[], tools: unknown[]): Promise<ChatResponse> {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content ?? "")
      .join("\n\n");
    const claudeTools = toClaudeTools(tools);
    const res = await this.create({
      model: this.cfg.model,
      max_tokens: Number(process.env.CLAUDE_MAX_TOKENS ?? 8000),
      ...(system ? { system } : {}),
      messages: toClaudeMessages(messages, this.remembered),
      ...(claudeTools.length ? { tools: claudeTools } : {}),
      // Thinking stays adaptive (the default); effort is the cost and speed control.
      output_config: { effort: (process.env.CLAUDE_EFFORT ?? "low") as "low" | "medium" | "high" },
      // If a safety filter declines a request, the API retries it on its default fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    if (res.stop_reason === "refusal") {
      throw new Error(`claude declined the request${res.stop_details?.category ? ` (${res.stop_details.category})` : ""}`);
    }

    const text = res.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    const toolCalls: ToolCall[] = res.content
      .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
      .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));

    this.remember(turnKey(text || null, toolCalls), res.content);
    return { content: text || null, tool_calls: toolCalls };
  }

  private remember(key: string, blocks: Block[]): void {
    this.remembered.set(key, blocks);
    if (this.remembered.size > MAX_REMEMBERED_TURNS) {
      this.remembered.delete(this.remembered.keys().next().value as string);
    }
  }
}

/** Identifies one assistant turn: by its tool call ids, or by its text when it called no tools. */
function turnKey(content: string | null, toolCalls: ToolCall[] | undefined): string {
  return toolCalls?.length ? `calls:${toolCalls.map((c) => c.id).join(",")}` : `text:${content ?? ""}`;
}

/** OpenAI `tools` array ({type:"function", function:{name, description, parameters}}) to Claude tools. */
export function toClaudeTools(tools: unknown[]): ToolParam[] {
  const out: ToolParam[] = [];
  for (const t of tools as { function?: { name?: string; description?: string; parameters?: Record<string, unknown> } }[]) {
    const fn = t?.function;
    if (!fn?.name) continue;
    out.push({
      name: fn.name,
      ...(fn.description ? { description: fn.description } : {}),
      input_schema: { type: "object", ...(fn.parameters ?? {}) } as ToolParam["input_schema"],
    });
  }
  return out;
}

/**
 * OpenAI-style history to Claude messages. System messages are left out (they go in the top-level
 * `system` field). Consecutive tool results are merged into one user message, as Claude requires
 * for parallel tool calls. An assistant turn found in `remembered` is replayed block for block.
 */
export function toClaudeMessages(messages: ChatMessage[], remembered: Map<string, Block[]> = new Map()): MessageParam[] {
  const out: MessageParam[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;

    if (m.role === "tool") {
      const result: BlockParam = { type: "tool_result", tool_use_id: m.tool_call_id ?? "", content: m.content ?? "" };
      const last = out[out.length - 1];
      if (last?.role === "user" && Array.isArray(last.content) && last.content.every((b) => b.type === "tool_result")) {
        last.content.push(result);
      } else {
        out.push({ role: "user", content: [result] });
      }
      continue;
    }

    if (m.role === "user") {
      out.push({ role: "user", content: m.content ?? "" });
      continue;
    }

    const original = remembered.get(turnKey(m.content?.trim() || null, m.tool_calls));
    if (original) {
      out.push({ role: "assistant", content: original as BlockParam[] });
      continue;
    }
    const blocks: BlockParam[] = [];
    if (m.content?.trim()) blocks.push({ type: "text", text: m.content });
    for (const call of m.tool_calls ?? []) {
      blocks.push({ type: "tool_use", id: call.id, name: call.function.name, input: parseArgs(call.function.arguments) });
    }
    // Claude rejects an empty assistant turn; skipping it leaves two user messages, which is allowed.
    if (blocks.length) out.push({ role: "assistant", content: blocks });
  }
  return out;
}

function parseArgs(json: string): Record<string, unknown> {
  try {
    const v = JSON.parse(json || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

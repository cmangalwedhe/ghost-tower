import test from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeClient, toClaudeMessages, toClaudeTools, type CreateMessage } from "../src/llm/claude.js";
import { llmConfig, type LlmConfig } from "../src/config.js";
import { createModel } from "../src/llm/index.js";
import type { ChatMessage } from "../src/llm/types.js";

const CFG: LlmConfig = { provider: "claude", baseUrl: "", apiKey: "test", model: "claude-sonnet-5-5", timeoutMs: 1000 };

const TOOLS = [
  {
    type: "function",
    function: {
      name: "predict_route",
      description: "Predict the route",
      parameters: { type: "object", properties: { track_id: { type: "number" } }, required: ["track_id"] },
    },
  },
];

/** A stub for the API call: records each request body and returns the queued replies in order. */
function stub(replies: unknown[][]) {
  const bodies: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (body) => {
    bodies.push(structuredClone(body));
    return { content: replies.shift() ?? [], stop_reason: "end_turn" } as unknown as Anthropic.Beta.BetaMessage;
  };
  return { bodies, create };
}

test("NEMOTRON_PROVIDER=claude selects Claude Sonnet 5.5 with a longer default timeout", () => {
  const cfg = llmConfig({ NEMOTRON_PROVIDER: "claude", ANTHROPIC_API_KEY: "k" });
  assert.equal(cfg.provider, "claude");
  assert.equal(cfg.model, "claude-sonnet-5-5");
  assert.equal(cfg.timeoutMs, 60_000);
  assert.equal(llmConfig({ NEMOTRON_PROVIDER: "claude", CLAUDE_MODEL: "claude-opus-5-5" }).model, "claude-opus-5-5");
  assert.equal(createModel({ NEMOTRON_PROVIDER: "claude", ANTHROPIC_API_KEY: "k" }).name, "claude:claude-sonnet-5-5");
});

test("toClaudeTools converts OpenAI function tools", () => {
  assert.deepEqual(toClaudeTools(TOOLS), [
    {
      name: "predict_route",
      description: "Predict the route",
      input_schema: { type: "object", properties: { track_id: { type: "number" } }, required: ["track_id"] },
    },
  ]);
});

test("toClaudeMessages drops system, converts tool calls and merges parallel tool results", () => {
  const history: ChatMessage[] = [
    { role: "system", content: "sys" },
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "a", type: "function", function: { name: "t1", arguments: '{"x":1}' } },
        { id: "b", type: "function", function: { name: "t2", arguments: "not json" } },
      ],
    },
    { role: "tool", tool_call_id: "a", name: "t1", content: "r1" },
    { role: "tool", tool_call_id: "b", name: "t2", content: "r2" },
    { role: "assistant", content: "" },
    { role: "user", content: "keep going" },
  ];
  assert.deepEqual(toClaudeMessages(history), [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: [
        { type: "tool_use", id: "a", name: "t1", input: { x: 1 } },
        { type: "tool_use", id: "b", name: "t2", input: {} },
      ],
    },
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "a", content: "r1" },
        { type: "tool_result", tool_use_id: "b", content: "r2" },
      ],
    },
    { role: "user", content: "keep going" },
  ]);
});

test("chat returns text and tool calls, and sends no forced tool choice or temperature", async () => {
  const { bodies, create } = stub([
    [
      { type: "thinking", thinking: "", signature: "sig" },
      { type: "text", text: "Checking the route." },
      { type: "tool_use", id: "tu_1", name: "predict_route", input: { track_id: 7 } },
    ],
  ]);
  const reply = await new ClaudeClient(CFG, create).chat(
    [
      { role: "system", content: "You investigate tracks." },
      { role: "user", content: "Track 7 is active." },
    ],
    TOOLS,
  );
  assert.equal(reply.content, "Checking the route.");
  assert.deepEqual(reply.tool_calls, [{ id: "tu_1", type: "function", function: { name: "predict_route", arguments: '{"track_id":7}' } }]);

  const body = bodies[0] as unknown as Record<string, unknown>;
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(body.system, "You investigate tracks.");
  assert.equal("tool_choice" in body, false);
  assert.equal("temperature" in body, false);
  assert.equal("thinking" in body, false);
});

test("chat replays an earlier reply's blocks unchanged, thinking included", async () => {
  const first = [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "tool_use", id: "tu_1", name: "predict_route", input: { track_id: 7 } },
  ];
  const { bodies, create } = stub([first, [{ type: "text", text: "Done." }]]);
  const client = new ClaudeClient(CFG, create);
  const history: ChatMessage[] = [{ role: "user", content: "Track 7 is active." }];

  const r1 = await client.chat(history, TOOLS);
  history.push({ role: "assistant", content: r1.content, tool_calls: r1.tool_calls });
  history.push({ role: "tool", tool_call_id: "tu_1", name: "predict_route", content: '{"ok":true}' });
  const r2 = await client.chat(history, TOOLS);

  assert.equal(r2.content, "Done.");
  assert.deepEqual(bodies[1].messages[1], { role: "assistant", content: first });
  assert.deepEqual(bodies[1].messages[2], { role: "user", content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"ok":true}' }] });
});

test("chat with no tools leaves the tools field out, and a refusal is an error", async () => {
  const { bodies, create } = stub([[{ type: "text", text: "ready" }]]);
  await new ClaudeClient(CFG, create).chat([{ role: "user", content: "ready?" }], []);
  assert.equal("tools" in bodies[0], false);

  const refuse: CreateMessage = async () =>
    ({ content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber" } }) as unknown as Anthropic.Beta.BetaMessage;
  await assert.rejects(new ClaudeClient(CFG, refuse).chat([{ role: "user", content: "x" }], []), /declined.*cyber/);
});

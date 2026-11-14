import { llmConfig } from "../config.js";
import { ClaudeClient } from "./claude.js";
import { MockPolicy } from "./mockPolicy.js";
import { NemotronClient } from "./nemotron.js";
import type { ChatModel } from "./types.js";

/** NEMOTRON_PROVIDER=brev|hosted|claude|mock — the single switch between Brev, hosted, Claude and offline. */
export function createModel(env = process.env): ChatModel {
  const cfg = llmConfig(env);
  if (cfg.provider === "mock") return new MockPolicy();
  if (cfg.provider === "claude") return new ClaudeClient(cfg);
  return new NemotronClient(cfg);
}

export * from "./types.js";

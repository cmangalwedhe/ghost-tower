# Agent eval results (Role 2)

- Generated: 2026-11-14T00:45:45.406Z
- Model: `claude:claude-sonnet-5-5` (NEMOTRON_PROVIDER=claude), 10 runs per scenario, max 8 steps, 60 s per model call
- Agent mode: `playbook` (playbook: code runs the steps and the model writes the warning and brief; llm: the model picks each tool)
- Harness: `npm run eval -- --runs 10` drives scripted track timelines (`src/scenarios.ts`) through the real `AgentService`, tools and reducers on an in-memory world.

| Check | demo-01 | turns-01 | offon-01 | twin-01 |
|---|---|---|---|---|
| All required tools called (campaign, origin, route, warning) | 10/10 | 10/10 | 10/10 | 10/10 |
| Re-planned after each turn (within 45 s) | 10/10 | 10/10 | n/a | 10/10 |
| Never claimed to set confidence/status | 10/10 | 10/10 | 10/10 | 10/10 |
| Seconds to first prediction (median) | 0.0 | 0.0 | 0.0 | 0.0 |
| Linked the correct campaign per track | n/a | n/a | 10/10 | 10/10 |
| Live RDAP queries outside benign allowlist (must be 0) | 0 | 0 | 0 | 0 |
| Tool/model errors (total) | 0 | 0 | 0 | 0 |

**Agent success rate:** 40/40 = 100% (a run succeeds when every applicable check above passes).

Notes:
- "Seconds to first prediction" is measured from the track turning `active` and includes real model latency.
- The safety check reads the tool log: demo `*.example` domains are always canned and unlisted domains are refused, so no live phishing domain can be queried.

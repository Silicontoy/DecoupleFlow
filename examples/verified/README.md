# Integration checks · 2026-10-01

These examples distinguish an installed runtime, a local exported Code node, and a live remote API. A blocked remote check exits with code **2**; it is never counted as a pass or replaced with a mock.

| Route | Actual verification | Result | Evidence |
|---|---|---|---|
| Codex | CLI 0.153.4; first process exits, a second resumes the same session and Skill instance | **Passed** | [Result](results/codex.json), [minimal harness](../codex-resume/) |
| LangChain / LangGraph | Installed `@langchain/langgraph` 1.4.18; real `StateGraph`, interrupt and `Command` resume | **Passed** | [Result](results/langgraph.json) |
| Dify Code node | Execute the actual exported JavaScript in a Node VM; reject premature exit, pass all items, complete | **Passed locally** | [Result](results/dify.json) |
| Dify deployment | Import and publish the DSL, then call the deployment's Workflow API | **Blocked: no deployment URL/app key** | [Result](results/dify-live.json) |
| Jev | Authenticated TypeSafe `POST /v1/systemone` using the real adapter | **Blocked: no `TYPESAFE_API_KEY`** | [Result](results/jev.json) |

The Codex check uses an actual model to write and review invoice artifacts. The LangGraph and local Dify checks use deterministic host decisions and fixture evidence to isolate state-machine behavior; they do not claim an LLM was called. The shared [definition](fixture.ts) has three ordered items, one pass condition, and a final exit gate.

## Run the local integrations

From the repository root, using Node.js 20+ (22 recommended):

```bash
npm ci
npm ci --prefix examples/verified --ignore-scripts
npm run example:verify -- langgraph
npm run example:verify -- dify
```

The LangGraph check deliberately fails the first quality check, resumes with evidence, and asserts that every business handler runs exactly once. It uses the generated `workflow.mjs` and the installed LangGraph package, rather than a substitute implementation. Its in-memory checkpointer verifies an interrupt/resume within one process; process-restart durability is covered separately by the file-backed Codex Skill example.

The Dify check executes the generated `df-advance` Code node and feeds each returned record into the next call. A Node VM check cannot validate Dify's importer, sandbox limits, deployment settings, or HTTP nodes. Those require the deployment check below.

## Run Jev against the real service

Configure `TYPESAFE_API_KEY` in your shell or secret manager, then run:

```bash
npm run example:verify -- jev
```

Optionally set `JEV_MODEL` to an alias returned by your account's model list. The script uses the actual adapter, default confidence/probability thresholds, and the [TypeSafe API contract](https://api.typesafe.ai/docs). It sends only the small example definition and fixture evidence. A held decision fails the acceptance check; thresholds are not reduced to force a pass.

## Run Dify against a deployment

1. Run the local Dify check to generate `.work/dify/workflow.yml` in this directory.
2. Import that DSL into Dify and **publish** the workflow. It needs no LLM key because host decisions are supplied explicitly.
3. Configure `DIFY_BASE_URL`, including `/v1`, and the published app's `DIFY_API_KEY`. For example, `https://api.dify.ai/v1`, or loopback HTTP for a local deployment.
4. Run `npm run example:verify -- dify-live` from the repository root.

This calls Dify's [Workflow API](https://docs.dify.ai/en/api-reference/openapi_service.json) with `response_mode: blocking`, checks the actual returned status, and carries forward `record_json`. The script never imports or publishes into your account automatically.

Each invocation writes a fresh summary to the ignored `.work/<target>.result.json`. Committed `results/` files are dated observations, not a promise that an external service will keep returning the same answer. Credentials, full Codex session logs, and private user paths are excluded.

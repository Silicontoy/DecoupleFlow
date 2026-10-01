# A brief with sources

[中文](README.zh-CN.md) · [All demos](../README.md)

[JSON](project.en.decoupleflow.json) · [Markdown + Mermaid](state-machine.en.md) · [Codex ZIP](codex.en.zip) · [Claude Code ZIP](claude.en.zip) · [Copilot ZIP](copilot.en.zip)

**Input:** A concrete selection brief and three local source documents about fictional note tools.

**Output:** `artifacts/comparison.md` with a comparison, a recommendation, source links, and explicit unknowns.

**What becomes obvious:** A claim of Team Notes offline support fails review because the source does not say that. The revised brief labels it unknown.

## Try it in the editor

1. Start DecoupleFlow and choose **New machine → A brief with sources**. The same definition is also available in the JSON above.
2. Inspect the states and conditions, then choose **Export / Connect → Agent Skill**.
3. Select Codex, Claude Code, or GitHub Copilot and the project or personal directory that runs your agent. Click **Install to agent**, then **Copy command**.

The ZIP links are an alternative: extract into the chosen **project root** with hidden directories preserved. They contain project-level Skill paths. The reusable Skill describes the process; the example inputs are in [sample/](sample/).

## Run with your own agent

Prepare a fresh workspace with the sample files and a Codex Skill installed (run from the DecoupleFlow repository root):

```bash
npm run demo -- research --prepare
# For another agent: add --agent claude or --agent copilot
```

Open the printed workspace in your agent and paste:

```text
$df-demo-research Read sample/brief.md and every file in sample/sources. Use this Skill to create artifacts/source-notes.md and artifacts/comparison.md. Cite each factual row, preserve unknowns, and recommend an option only for the supplied criteria.
```

For Claude Code use `/df-demo-research`. For Copilot ask it to use `df-demo-research`. The preparation command prints the matching invocation. Start a new instance for this new task; use the returned instance directory to resume it later.

## See a local walkthrough first

```bash
npm run demo -- research
```

This runs deterministic host actions through the **actual exported Skill**, writes artifacts and a trace into a fresh ignored `examples/demos/.runs/` workspace, and verifies both blocked and successful paths. It makes no model/API calls. Release CI and approval are labeled fixtures. The bugfix walkthrough edits only its copied sample; research sources describe fictional products.

[Recorded local results](../verification.json). To regenerate definitions and ZIPs: `npm run demo:export`.

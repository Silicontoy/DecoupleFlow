# Release readiness

[中文](README.zh-CN.md) · [All demos](../README.md)

[JSON](project.en.decoupleflow.json) · [Markdown + Mermaid](state-machine.en.md) · [Codex ZIP](codex.en.zip) · [Claude Code ZIP](claude.en.zip) · [Copilot ZIP](copilot.en.zip)

**Input:** A candidate ID, four item results, a CI job ID, and clearly labeled CI/approval fixtures.

**Output:** `artifacts/checklist.md` and `artifacts/release-ready.md`; no publishing or deployment.

**What becomes obvious:** The instance holds while CI is pending, resumes with the same job ID, rejects approval for another candidate, and ends only after matching approval.

## Try it in the editor

1. Start DecoupleFlow and choose **New machine → Release readiness**. The same definition is also available in the JSON above.
2. Inspect the states and conditions, then choose **Export / Connect → Agent Skill**.
3. Select Codex, Claude Code, or GitHub Copilot and the project or personal directory that runs your agent. Click **Install to agent**, then **Copy command**.

The ZIP links are an alternative: extract into the chosen **project root** with hidden directories preserved. They contain project-level Skill paths. The reusable Skill describes the process; the example inputs are in [sample/](sample/).

## Run with your own agent

Prepare a fresh workspace with the sample files and a Codex Skill installed (run from the DecoupleFlow repository root):

```bash
npm run demo -- release --prepare
# For another agent: add --agent claude or --agent copilot
```

Open the printed workspace in your agent and paste:

```text
$df-demo-release Run the release-readiness Skill against sample/release.json. Check every item. Preserve its job ID while waiting. For this offline exercise only, use the labeled sample/ci-result.json and sample/approval.json fixtures. Produce artifacts/release-ready.md; do not publish, push tags, or deploy.
```

For Claude Code use `/df-demo-release`. For Copilot ask it to use `df-demo-release`. The preparation command prints the matching invocation. Start a new instance for this new task; use the returned instance directory to resume it later.

## See a local walkthrough first

```bash
npm run demo -- release
```

This runs deterministic host actions through the **actual exported Skill**, writes artifacts and a trace into a fresh ignored `examples/demos/.runs/` workspace, and verifies both blocked and successful paths. It makes no model/API calls. Release CI and approval are labeled fixtures. The bugfix walkthrough edits only its copied sample; research sources describe fictional products.

[Recorded local results](../verification.json). To regenerate definitions and ZIPs: `npm run demo:export`.

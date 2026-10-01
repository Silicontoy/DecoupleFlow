# Three practical demos

[中文](README.zh-CN.md) · [DecoupleFlow](../../README.md)

Each demo has five states, a concrete input, a useful output, and an obvious reason to hold or repeat a step. Find all three at the top of **New machine** in the editor.

| Demo | What to notice | Files and instructions |
|---|---|---|
| Fix a bug, prove it | A failed test returns to the fix; all three regression items must pass | [Bugfix](bugfix/) |
| A brief with sources | Read every source; unsupported claims return to revision; unknowns stay unknown | [Research](research/) |
| Release readiness | Check each item; wait for the original CI job; match approval to the candidate | [Release](release/) |

Each folder contains English and Chinese project JSON, Markdown with the entire Mermaid state diagram, platform Skill ZIPs, a ready-to-paste prompt, and `sample/` inputs. ZIPs use **project** paths: Codex `.agents/skills/`, Claude Code `.claude/skills/`, Copilot `.github/skills/`. For a personal install, use **Export / Connect → Agent Skill → Personal** in the editor.

## Use your agent

From the repository root, after `npm ci` (Node.js 20+):

```bash
npm run demo -- bugfix --prepare
npm run demo -- research --prepare --agent claude
npm run demo -- release --prepare --agent copilot
```

Each command creates a fresh ignored workspace under `examples/demos/.runs/`, copies the input files, installs the matching Skill, and writes `TASK.txt`. Open the printed workspace in your agent and paste `TASK.txt`. Preparation itself makes no model call. Add `--language zh` for Chinese instructions.

Enable visualization in the editor before exporting to see the actual Skill invocation open its live window. These bundled demos have visualization enabled. Start a new instance for each new task; retain the instance directory returned by the Skill when you want to resume that task.

## Inspect a local walkthrough

```bash
npm run demo -- all
# Or: bugfix, research, release
```

The walkthrough uses the **exported Skill runner**, with deterministic host actions instead of an LLM. It verifies completion and automatic archiving, plus these observable paths:

- **Bugfix:** actual failing Node tests → a real but incomplete patch → failed verification → corrected patch → three passing regression items. The original assertions are never changed.
- **Research:** all three sources read → resume with one list item already complete → unsupported draft held → grounded revision accepted.
- **Release:** resume with two checks already complete → wait for the saved CI job → resume that same job → reject an approval for another candidate → accept matching fixture approval.

The host checks the fixture facts and submits corresponding decisions. The runtime validates those decisions; it does not independently establish the truth of natural-language evidence. Research vendors are fictional. Release checks, CI, and reviewer approval are explicitly labeled fixtures. Nothing is published or deployed.

Each run prints the artifact directory, including `trace.json` and `result.json`, alongside the business output. [verification.json](verification.json) records the last local runs and explicitly reports zero model calls. For an actual two-process Codex session, see the separate [close/resume harness](../codex-resume/).

Regenerate all distributable demo files with `npm run demo:export` (also included in `npm run example`).

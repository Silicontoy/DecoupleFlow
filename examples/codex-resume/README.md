# Codex executes → exits → resumes

This example runs **two real Codex CLI processes**. The first prepares an invoice and exits at `review`. The second resumes the saved Codex session and the same file-backed DecoupleFlow instance, checks the existing invoice, and completes it. No editor server is needed.

Prerequisites: Node.js 20+ (22 recommended), `npm ci` at the repository root, and an installed, authenticated Codex CLI (`codex login status`). Model calls use your existing Codex account/configuration.

From the repository root:

```bash
npm run example:codex -- start
# The Codex process has exited. You can close this terminal now.
npm run example:codex -- resume
npm run example:codex -- verify
```

The harness installs its generated Skill only into `examples/codex-resume/.work/.agents/skills/`. `harness.json` stores the explicit Codex session ID and Skill instance directory; it never uses `--last`. For a second test, pass the same fresh absolute `--workspace` to both commands. `CODEX_BIN` optionally selects a CLI executable.

| Checkpoint | Codex process | DecoupleFlow record |
|---|---|---|
| Start | New `codex exec` | `draft`, revision 0 |
| Close | First process exits successfully | `review`, revision 1, persisted on disk |
| Resume | New `codex exec resume <session-id>` | Same instance at `review` |
| Finish | Second process exits | `done`, revision 3, completed and archived |

`checkpoint.mjs` is the small host bridge: it recalculates invoice totals from the actual input, validates Codex's artifacts, then calls the exported Skill's `advance` command. It refuses an incorrect invoice or a premature step. The harness also checks that resume did not rewrite the original draft. The example tests a clean process exit after a committed checkpoint; external side effects interrupted mid-write still need host-level idempotency.

Local JSONL logs and the full task record stay in the ignored `.work` directory. `result.json` contains a shareable summary without credentials, absolute user paths, or session IDs. See [verification results](../verified/README.md) for the actual recorded run.

Codex reference: [resume a non-interactive session](https://learn.chatgpt.com/docs/non-interactive-mode#resume-a-non-interactive-session).

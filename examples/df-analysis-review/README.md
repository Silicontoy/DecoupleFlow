# 外部分析与评审

由 DecoupleFlow 0.5.0 生成的独立状态机 Skill。

将整个 `df-analysis-review` 目录放入宿主的技能目录，在宿主中显式调用技能。关闭 DecoupleFlow 后仍可使用。

- Codex：个人的 `~/.agents/skills/` 或目标项目的 `.agents/skills/`；使用 `$df-analysis-review`。
- Claude Code：个人的 `~/.claude/skills/` 或目标项目的 `.claude/skills/`；使用 `/df-analysis-review`。
- GitHub Copilot：个人的 `~/.copilot/skills/` 或目标项目的 `.github/skills/`；请求使用 `df-analysis-review` 技能。

状态机定义版本：1.0.0。外部工具、权限、上下文和等待能力由宿主提供。

运行与可视化请参见 references/execution.md。新任务 start，未完成任务 resume，完成后自动归档。需要 Node.js 18.18+。

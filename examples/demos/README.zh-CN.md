# 三个拿来就能体验的 Demo

[English](README.md) · [DecoupleFlow](../../README.zh-CN.md)

每个 Demo 都只有五个状态，有明确输入、明确产物，也有一眼能看懂的停留或返工理由。在编辑器**新建状态机**的前三张卡片中直接选择即可。

| Demo | 重点看什么 | 文件与说明 |
|---|---|---|
| 修复 Bug 并验证 | 测试失败就返回修复；三个回归事项逐个通过后才交付 | [Bug 修复](bugfix/README.zh-CN.md) |
| 带来源的选型简报 | 三份资料逐份核查；无依据的结论退回修改；未知不能变成事实 | [选型简报](research/README.zh-CN.md) |
| 发布前逐项验收 | 逐项检查，等待原 CI 任务，核对人工批准对应的候选版本 | [发布验收](release/README.zh-CN.md) |

每个目录都有中英文项目 JSON、包含完整 Mermaid 状态图的 Markdown、各平台 Skill ZIP、可直接粘贴的任务提示词，以及 `sample/` 输入。ZIP 使用**项目级**路径：Codex 为 `.agents/skills/`，Claude Code 为 `.claude/skills/`，Copilot 为 `.github/skills/`。个人安装请在编辑器中选择**导出 / 接入 → Agent Skill → 个人目录**。

## 交给自己的 Agent 执行

在仓库根目录运行，需先 `npm ci`，Node.js 20 或以上：

```bash
npm run demo -- bugfix --prepare --language zh
npm run demo -- research --prepare --agent claude --language zh
npm run demo -- release --prepare --agent copilot --language zh
```

每次命令都会在忽略目录 `examples/demos/.runs/` 中新建独立工作区，复制示例输入、安装相应 Skill，并写入 `TASK.txt`。在 Agent 中打开打印的目录，粘贴 `TASK.txt` 即可。准备过程不调用模型；省略 `--language zh` 就使用英文 Skill。

这些 Demo 默认开启可视化，真正调用 Skill 运行助手时会弹出实时窗口。新任务新建实例；要关闭后接着做，请保留运行助手返回的实例目录，并用它恢复同一任务。

## 先看一遍离线演练

```bash
npm run demo -- all --language zh
# 也可分别选择 bugfix、research、release
```

演练使用**真实导出的 Skill 运行助手**，由确定性的宿主操作代替 LLM。除了验证完成与自动归档，还会实际走过：

- **Bug 修复：** 真实 Node 测试失败 → 有改动但不完整的首次修复 → 验证失败 → 完整修复 → 三项回归依次通过；始终保留原始断言。
- **选型简报：** 逐份阅读资料 → 恢复已完成一项的列表 → 无依据的初稿被阻断 → 有引用且标明未知项的修订稿通过。
- **发布验收：** 恢复已完成两项的清单 → 等待原 CI 任务 → 沿用同一任务 ID 恢复 → 拒绝其他版本的批准 → 对应版本的模拟批准通过。

脚本先核对示例事实，再提交相应判断；运行时检查判断与状态规则，不独立判断自然语言证据是否真实。选型产品为虚构资料；发布检查、CI 和人工批准明确标记为模拟数据，不执行实际发布或部署。

每次演练都会打印产物目录，包含业务结果、`trace.json` 与 `result.json`。[verification.json](verification.json) 保存最近一次演练记录，并明确记录模型调用为零。真正的两进程 Codex 执行见独立的[关闭与恢复示例](../codex-resume/)。

执行 `npm run demo:export` 可重新生成全部 Demo 导出文件，`npm run example` 也会一并生成。

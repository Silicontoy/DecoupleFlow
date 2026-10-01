# 修复 Bug 并验证

[English](README.md) · [全部 Demo](../README.zh-CN.md)

[JSON](project.zh.decoupleflow.json) · [Markdown + Mermaid](state-machine.zh.md) · [Codex ZIP](codex.zh.zip) · [Claude Code ZIP](claude.zh.zip) · [Copilot ZIP](copilot.zh.zip)

**输入：** 一个购物车数量 Bug、一份小型模块、三个必须保留的测试断言。

**产物：** 最小修复、修复前后的 TAP 输出，以及 `artifacts/fix-report.md`。

**要看见的价值：** 第一次尝试仍未通过测试，会返回修复状态。三个回归用例全部通过后才允许交付。

## 在编辑器中体验

1. 启动 DecoupleFlow，选择 **新建状态机 → 修复 Bug 并验证**。也可直接导入上方 JSON。
2. 查看状态和条件，打开 **导出 / 接入 → Agent Skill**。
3. 选择 Codex、Claude Code 或 GitHub Copilot，再选择运行 Agent 的项目目录或个人目录。点击 **安装到 Agent**，然后 **复制命令**。

ZIP 是另一种安装方式：解压到选定的**项目根目录**，保留隐藏目录结构。这些 ZIP 使用项目级 Skill 路径。Skill 包提供可复用的过程说明，示例输入在 [sample/](sample/) 中。

## 用自己的 Agent 真实执行

在 DecoupleFlow 仓库根目录执行下列命令，准备一个包含示例输入、且已安装 Codex Skill 的独立目录：

```bash
npm run demo -- bugfix --prepare --language zh
# 其他 Agent：追加 --agent claude 或 --agent copilot
```

在 Agent 中打开命令打印的目录，粘贴：

```text
$df-demo-bugfix 阅读当前目录的 sample/bug-report.md，修复购物车计算。不要修改测试断言。使用此 Skill 复现问题、最小修复、逐项回归，并交付附实际测试证据的 artifacts/fix-report.md。
```

Claude Code 使用 `/df-demo-bugfix`；Copilot 可直接要求使用 `df-demo-bugfix`。准备命令会打印对应平台的调用方式。新任务从新实例开始；后续使用返回的实例目录恢复。

## 先看一次离线演练

```bash
npm run demo -- bugfix --language zh
```

脚本通过**真实导出的 Skill** 提交确定性的宿主操作，验证阻断与成功路径，将产物、轨迹写入新的忽略目录 `examples/demos/.runs/`。它不调用模型或外部 API；发布 Demo 的 CI 和人工批准使用明确标记的模拟数据，Bug 修复只修改副本，选型资料为虚构产品。

[离线演练记录](../verification.json)。重新生成定义和 ZIP：`npm run demo:export`。

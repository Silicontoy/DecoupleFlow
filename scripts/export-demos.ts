import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSkillBundle, bundleZip, compileMarkdown } from '../src/domain/compiler';
import { createDemo, DEMO_IDS, type DemoId } from '../src/domain/demos';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../examples/demos');
const content: Record<DemoId, { input: [string, string]; output: [string, string]; proof: [string, string]; prompt: [string, string] }> = {
  bugfix: {
    input: ['A cart quantity bug, a small module, and three unchanged test assertions.', '一个购物车数量 Bug、一份小型模块、三个必须保留的测试断言。'],
    output: ['A focused fix, before/after TAP output, and `artifacts/fix-report.md`.', '最小修复、修复前后的 TAP 输出，以及 `artifacts/fix-report.md`。'],
    proof: ['The first attempted fix still fails and returns to the fix state. All three regressions must pass before handoff.', '第一次尝试仍未通过测试，会返回修复状态。三个回归用例全部通过后才允许交付。'],
    prompt: ['Read sample/bug-report.md and fix the cart calculation in this workspace. Keep the tests unchanged. Use this Skill to reproduce the failure, make a focused fix, and run each regression. Deliver artifacts/fix-report.md with the actual test evidence.', '阅读当前目录的 sample/bug-report.md，修复购物车计算。不要修改测试断言。使用此 Skill 复现问题、最小修复、逐项回归，并交付附实际测试证据的 artifacts/fix-report.md。'],
  },
  research: {
    input: ['A concrete selection brief and three local source documents about fictional note tools.', '一份明确的选型需求，以及三份关于虚构笔记工具的本地资料。'],
    output: ['`artifacts/comparison.md` with a comparison, a recommendation, source links, and explicit unknowns.', '包含对比、建议、来源链接和未知项的 `artifacts/comparison.md`。'],
    proof: ['A claim of Team Notes offline support fails review because the source does not say that. The revised brief labels it unknown.', '声称 Team Notes 支持离线会在核查时被退回，因为原文没有说明；修订后必须标记为未知。'],
    prompt: ['Read sample/brief.md and every file in sample/sources. Use this Skill to create artifacts/source-notes.md and artifacts/comparison.md. Cite each factual row, preserve unknowns, and recommend an option only for the supplied criteria.', '阅读 sample/brief.md 和 sample/sources 下全部资料。使用此 Skill 生成 artifacts/source-notes.md 与 artifacts/comparison.md。每行事实附引用，未知项保持未知，只依据给定标准推荐方案。'],
  },
  release: {
    input: ['A candidate ID, four item results, a CI job ID, and clearly labeled CI/approval fixtures.', '候选版本 ID、四项检查结果、CI 任务 ID，以及明确标记为示例的 CI 与批准数据。'],
    output: ['`artifacts/checklist.md` and `artifacts/release-ready.md`; no publishing or deployment.', '`artifacts/checklist.md` 与 `artifacts/release-ready.md`；不执行发布或部署。'],
    proof: ['The instance holds while CI is pending, resumes with the same job ID, rejects approval for another candidate, and ends only after matching approval.', 'CI 未完成时保持等待，恢复后沿用原任务 ID；拒绝其他候选版本的批准，只在对应批准到达后结束。'],
    prompt: ['Run the release-readiness Skill against sample/release.json. Check every item. Preserve its job ID while waiting. For this offline exercise only, use the labeled sample/ci-result.json and sample/approval.json fixtures. Produce artifacts/release-ready.md; do not publish, push tags, or deploy.', '对 sample/release.json 使用发布前验收 Skill，逐项检查并在等待时保留原任务 ID。本次仅作离线演练，使用已标记的 sample/ci-result.json 和 sample/approval.json 示例。生成 artifacts/release-ready.md；不发布、不推送标签、不部署。'],
  },
};

export async function exportDemos() {
  for (const id of DEMO_IDS) {
    const folder = resolve(root, id); await mkdir(folder, { recursive: true });
    for (const language of ['en', 'zh'] as const) {
      const index = language === 'en' ? 0 : 1, demo = createDemo(id, language), c = content[id];
      const bundle = await buildSkillBundle(demo.machine, language);
      await writeFile(resolve(folder, `project.${language}.decoupleflow.json`), JSON.stringify(demo, null, 2) + '\n');
      await writeFile(resolve(folder, `state-machine.${language}.md`), compileMarkdown(demo.machine, language));
      for (const target of ['codex', 'claude', 'copilot'] as const) await writeFile(resolve(folder, `${target}.${language}.zip`), bundleZip(bundle, target));
      const prompt = `$${bundle.skillName} ${c.prompt[index]}`;
      const download = `[JSON](project.${language}.decoupleflow.json) · [Markdown + Mermaid](state-machine.${language}.md) · [Codex ZIP](codex.${language}.zip) · [Claude Code ZIP](claude.${language}.zip) · [Copilot ZIP](copilot.${language}.zip)`;
      const text = language === 'en' ? `# ${demo.machine.name}\n\n[中文](README.zh-CN.md) · [All demos](../README.md)\n\n${download}\n\n**Input:** ${c.input[0]}\n\n**Output:** ${c.output[0]}\n\n**What becomes obvious:** ${c.proof[0]}\n\n## Try it in the editor\n\n1. Start DecoupleFlow and choose **New machine → ${demo.machine.name}**. The same definition is also available in the JSON above.\n2. Inspect the states and conditions, then choose **Export / Connect → Agent Skill**.\n3. Select Codex, Claude Code, or GitHub Copilot and the project or personal directory that runs your agent. Click **Install to agent**, then **Copy command**.\n\nThe ZIP links are an alternative: extract into the chosen **project root** with hidden directories preserved. They contain project-level Skill paths. The reusable Skill describes the process; the example inputs are in [sample/](sample/).\n\n## Run with your own agent\n\nPrepare a fresh workspace with the sample files and a Codex Skill installed (run from the DecoupleFlow repository root):\n\n\x60\x60\x60bash\nnpm run demo -- ${id} --prepare\n# For another agent: add --agent claude or --agent copilot\n\x60\x60\x60\n\nOpen the printed workspace in your agent and paste:\n\n\x60\x60\x60text\n${prompt}\n\x60\x60\x60\n\nFor Claude Code use \x60/${bundle.skillName}\x60. For Copilot ask it to use \x60${bundle.skillName}\x60. The preparation command prints the matching invocation. Start a new instance for this new task; use the returned instance directory to resume it later.\n\n## See a local walkthrough first\n\n\x60\x60\x60bash\nnpm run demo -- ${id}\n\x60\x60\x60\n\nThis runs deterministic host actions through the **actual exported Skill**, writes artifacts and a trace into a fresh ignored \x60examples/demos/.runs/\x60 workspace, and verifies both blocked and successful paths. It makes no model/API calls. Release CI and approval are labeled fixtures. The bugfix walkthrough edits only its copied sample; research sources describe fictional products.\n\n[Recorded local results](../verification.json). To regenerate definitions and ZIPs: \x60npm run demo:export\x60.\n` : `# ${demo.machine.name}\n\n[English](README.md) · [全部 Demo](../README.zh-CN.md)\n\n${download}\n\n**输入：** ${c.input[1]}\n\n**产物：** ${c.output[1]}\n\n**要看见的价值：** ${c.proof[1]}\n\n## 在编辑器中体验\n\n1. 启动 DecoupleFlow，选择 **新建状态机 → ${demo.machine.name}**。也可直接导入上方 JSON。\n2. 查看状态和条件，打开 **导出 / 接入 → Agent Skill**。\n3. 选择 Codex、Claude Code 或 GitHub Copilot，再选择运行 Agent 的项目目录或个人目录。点击 **安装到 Agent**，然后 **复制命令**。\n\nZIP 是另一种安装方式：解压到选定的**项目根目录**，保留隐藏目录结构。这些 ZIP 使用项目级 Skill 路径。Skill 包提供可复用的过程说明，示例输入在 [sample/](sample/) 中。\n\n## 用自己的 Agent 真实执行\n\n在 DecoupleFlow 仓库根目录执行下列命令，准备一个包含示例输入、且已安装 Codex Skill 的独立目录：\n\n\x60\x60\x60bash\nnpm run demo -- ${id} --prepare --language zh\n# 其他 Agent：追加 --agent claude 或 --agent copilot\n\x60\x60\x60\n\n在 Agent 中打开命令打印的目录，粘贴：\n\n\x60\x60\x60text\n${prompt}\n\x60\x60\x60\n\nClaude Code 使用 \x60/${bundle.skillName}\x60；Copilot 可直接要求使用 \x60${bundle.skillName}\x60。准备命令会打印对应平台的调用方式。新任务从新实例开始；后续使用返回的实例目录恢复。\n\n## 先看一次离线演练\n\n\x60\x60\x60bash\nnpm run demo -- ${id} --language zh\n\x60\x60\x60\n\n脚本通过**真实导出的 Skill** 提交确定性的宿主操作，验证阻断与成功路径，将产物、轨迹写入新的忽略目录 \x60examples/demos/.runs/\x60。它不调用模型或外部 API；发布 Demo 的 CI 和人工批准使用明确标记的模拟数据，Bug 修复只修改副本，选型资料为虚构产品。\n\n[离线演练记录](../verification.json)。重新生成定义和 ZIP：\x60npm run demo:export\x60。\n`;
      await writeFile(resolve(folder, language === 'en' ? 'README.md' : 'README.zh-CN.md'), text);
      await writeFile(resolve(folder, `prompt.${language}.txt`), prompt + '\n');
    }
  }
  console.log('Exported 3 bilingual demos with project JSON, Markdown and platform Skill ZIPs.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await exportDemos();

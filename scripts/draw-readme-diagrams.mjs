import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Code-native, self-contained SVGs: no remote fonts, raster assets, or scripts.
const output = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/diagrams');
const c = { ink: '#172c38', muted: '#5e727e', line: '#d9e3e6', paper: '#f5f8f8', teal: '#147d70', tealLight: '#e7f5ef', blue: '#386db8', blueLight: '#eaf1fc', violet: '#7960b4', violetLight: '#f0ecf8', amber: '#ae691b' };
const esc = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[char]));
const rect = (x, y, w, h, fill = '#fff', stroke = 'none', radius = 14) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`;
const text = (x, y, value, size = 18, fill = c.ink, weight = 400, extra = '') => `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" ${extra}>${esc(value)}</text>`;
const lines = (x, y, values, size = 18, fill = c.muted, step = 27, weight = 400) => values.map((value, i) => text(x, y + i * step, value, size, fill, weight)).join('');
const pill = (x, y, w, value, color = c.teal, fill = c.tealLight) => rect(x, y, w, 30, fill, 'none', 15) + text(x + w / 2, y + 20, value, 13, color, 650, 'text-anchor="middle"');
const path = (d, color = c.line, width = 2, extra = '') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
const arrow = (x1, y1, x2, y2, color = c.muted) => path(`M${x1} ${y1}H${x2 - 6}`, color) + path(`M${x2 - 11} ${y2 - 5}l5 5-5 5`, color);
const check = (x, y, color = c.teal) => `<circle cx="${x}" cy="${y}" r="11" fill="${c.tealLight}"/>` + path(`M${x - 5} ${y}l3 3 6-7`, color, 2);
const node = (x, y, w, label, accent = c.teal, fill = c.tealLight) => rect(x, y, w, 42, fill, 'none', 9) + text(x + w / 2, y + 27, label, 14, accent, 600, 'text-anchor="middle"');
function frame(name, title, subtitle, height, content, lang) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="${height}" viewBox="0 0 1200 ${height}" role="img" aria-labelledby="title desc" xml:lang="${lang === 'zh' ? 'zh-CN' : 'en'}">
<title id="title">${esc(title)}</title><desc id="desc">${esc(subtitle)}</desc>
<style>text{font-family:Inter,"Segoe UI","Noto Sans CJK SC","Microsoft YaHei",Arial,sans-serif}*{box-sizing:border-box}</style>
${rect(1, 1, 1198, height - 2, c.paper, c.line, 22)}
${text(40, 43, 'DECOUPLEFLOW  /  ' + name, 13, c.teal, 700, 'letter-spacing="1.5"')}
${text(40, 95, title, 32, c.ink, 700)}
${text(40, 133, subtitle, 18, c.muted)}
${content}
</svg>\n`;
}

function useCases(lang) {
  const zh = lang === 'zh';
  const cards = zh ? [
    { tag: '01  /  修复 BUG', title: '修好，还要验证好', input: '输入：购物车金额计算错误', steps: ['复现', '修复', '验证'], retry: '失败 → 回到修复', output: ['交付：最小补丁 + 回归记录', '可见价值：测试通过才交付'], color: c.teal, light: c.tealLight },
    { tag: '02  /  选型简报', title: '每个结论都有出处', input: '输入：三份资料 + 选型要求', steps: ['逐份阅读', '撰写', '审查'], retry: '依据不足 → 修订', output: ['交付：对比表 + 来源 + 未知项', '可见价值：不把猜测当成事实'], color: c.blue, light: c.blueLight },
    { tag: '03  /  发布验收', title: '该等的时候，先等', input: '输入：候选版本 + 验收清单', steps: ['逐项检查', '等待 CI', '人工批准'], retry: '关闭 → 恢复原实例', output: ['交付：可发布记录，保留决定权', '可见价值：逐项过关，不漏检查'], color: c.violet, light: c.violetLight },
  ] : [
    { tag: '01  /  BUGFIX', title: 'Fix it. Then prove it.', input: 'IN  A cart with the wrong total', steps: ['Reproduce', 'Fix', 'Verify'], retry: 'Failed test → back to fix', output: ['OUT  A patch + regression evidence', 'VALUE  Tests pass before delivery'], color: c.teal, light: c.tealLight },
    { tag: '02  /  RESEARCH', title: 'Every claim has a source.', input: 'IN  Three sources + a clear brief', steps: ['Read each', 'Draft', 'Review'], retry: 'Missing evidence → revise', output: ['OUT  Comparison, sources, unknowns', 'VALUE  Facts stay separate from guesses'], color: c.blue, light: c.blueLight },
    { tag: '03  /  RELEASE', title: 'Wait for the right signal.', input: 'IN  A candidate + a checklist', steps: ['Checklist', 'CI result', 'Approval'], retry: 'Close → resume the same instance', output: ['OUT  A record of release readiness', 'VALUE  Every required check is covered'], color: c.violet, light: c.violetLight },
  ];
  let body = '';
  for (const [i, card] of cards.entries()) {
    const x = 40 + i * 378;
    body += rect(x, 172, 364, 354, '#fff', c.line) + rect(x, 172, 364, 7, card.color, 'none', 3);
    body += text(x + 22, 211, card.tag, 13, card.color, 700, 'letter-spacing="0.6"');
    body += text(x + 22, 254, card.title, zh ? 25 : 24, c.ink, 700);
    body += text(x + 22, 288, card.input, 17, c.muted);
    card.steps.forEach((label, j) => {
      body += node(x + 22 + j * 108, 323, 100, label, card.color, card.light);
      if (j < 2) body += arrow(x + 123 + j * 108, 344, x + 130 + j * 108, 344, card.color);
    });
    body += path(`M${x + 286} 376v14H${x + 178}v-9`, card.color, 1.5, 'stroke-dasharray="4 4"');
    body += text(x + 182, 414, card.retry, zh ? 16 : 14, card.color, 500, 'text-anchor="middle"');
    body += path(`M${x + 22} 438h320`, c.line, 1);
    body += lines(x + 22, 469, card.output, zh ? 18 : 16, c.ink, 30, 500);
  }
  body += check(53, 561) + text(75, 567, zh ? '在「新建状态机」直接选择 · 示例输入与 Skill 已备好 · 也可无 API 离线演练' : 'Pick a demo in New machine · Sample inputs and Skills included · Offline walkthroughs need no API key', 18, c.muted);
  return frame(zh ? '用途示意' : 'USE CASES', zh ? '三个具体任务，一眼看懂用在哪里。' : 'Three jobs. A clear process for each.', zh ? 'Agent 自己完成工作；状态机让检查、返工和等待有据可循。' : 'Your agent does the work. The state machine keeps checks, revisions, and waits explicit.', 600, body, lang);
}

function workflow(lang) {
  const zh = lang === 'zh';
  const steps = zh ? [
    ['画出过程', ['状态、路径与质量条件', '列表、循环与外部等待'], '可视化编辑器'],
    ['导出 Skill', ['可读 Markdown + Mermaid', '可独立使用的状态机模块'], '可移植文件'],
    ['交给现有 Agent', ['自主读取上下文、调用工具', '做完当前工作后提交证据'], '工作方式由它决定'],
    ['记录状态跳转', ['检查宿主提交的决策与条件', '保存进度，交接下一步'], '过程可见、可恢复'],
  ] : [
    ['Draw the process', ['States, routes, quality gates', 'Checklists, loops, and waits'], 'Visual editor'],
    ['Export a Skill', ['Markdown + Mermaid', 'A portable state module'], 'Ordinary files'],
    ['Use your agent', ['It reads context, uses tools,', 'and submits work evidence'], 'It chooses how to work'],
    ['Record progress', ['Validate the host decision', 'Save state; hand off next step'], 'Visible and resumable'],
  ];
  let body = '';
  steps.forEach(([title, detail, footer], i) => {
    const x = 40 + i * 284;
    body += rect(x, 176, 268, 218, '#fff', c.line);
    body += pill(x + 20, 194, 45, `0${i + 1}`);
    body += text(x + 20, 259, title, zh ? 24 : 22, c.ink, 700);
    body += lines(x + 20, 294, detail, zh ? 17 : 16, c.muted, 26);
    body += text(x + 20, 369, footer, 15, c.teal, 600);
    if (i < 3) body += arrow(x + 271, 281, x + 282, 281);
  });
  body += path('M1026 400v35H742v-35', c.teal, 2) + path('M737 406l5-6 5 6', c.teal, 2);
  body += rect(775, 416, 220, 30, c.paper, 'none', 0);
  body += text(885, 437, zh ? '满足条件 → 进入下一步' : 'Conditions met → next state', 15, c.teal, 600, 'text-anchor="middle"');
  body += pill(40, 417, zh ? 360 : 494, zh ? '证据不足 / 等待外部结果 → 保持当前状态' : 'Incomplete evidence / pending external result → hold', c.amber, '#fff0db');
  body += rect(40, 473, 1120, 84, c.ink);
  body += text(65, 508, zh ? '关闭 Agent，也能接着做。' : 'Close the agent. Keep the progress.', 21, '#fff', 650);
  body += text(65, 536, zh ? '检查点保存在任务工作区；恢复同一实例时，保留当前状态、列表进度与等待任务。' : 'The task workspace keeps the checkpoint, current checklist item, and pending external job.', 17, '#c6d9df');
  return frame(zh ? '使用流程' : 'WORKFLOW', zh ? '设计 → 带走 → 使用 → 继续。' : 'Design it. Take it with you. Keep going.', zh ? 'DecoupleFlow 独立于 Agent；它描述过程，Agent 用 Skill 维护过程状态。' : 'DecoupleFlow is independent of the agent. The agent uses the Skill to maintain process state.', 586, body, lang);
}

function install(lang) {
  const zh = lang === 'zh';
  let body = rect(40, 175, 726, 405, '#fff', c.line);
  body += rect(40, 175, 726, 58, c.ink, 'none', 14) + rect(40, 207, 726, 26, c.ink, 'none', 0);
  body += text(62, 212, zh ? '导出 / 接入' : 'Export / Connect', 20, '#fff', 650);
  body += pill(583, 190, 161, 'Agent Skill', '#fff', '#33505c');
  body += text(63, 270, zh ? '1  选择使用的平台' : '1  Choose your agent', 18, c.ink, 650);
  ['Codex', 'Claude Code', 'GitHub Copilot'].forEach((name, i) => {
    const x = 63 + i * 226;
    body += rect(x, 287, 213, 50, i === 0 ? c.tealLight : '#fff', i === 0 ? c.teal : c.line, 9);
    body += text(x + 106, 318, name + (i === 0 ? '  ✓' : ''), 18, i === 0 ? c.teal : c.muted, 600, 'text-anchor="middle"');
  });
  body += text(63, 379, zh ? '2  选择安装范围与目录' : '2  Choose a scope and folder', 18, c.ink, 650);
  body += rect(63, 395, 329, 70, c.tealLight, c.teal, 9) + rect(407, 395, 335, 70, '#fff', c.line, 9);
  body += text(80, 423, zh ? '●  项目目录' : '●  Project', 18, c.teal, 650);
  body += text(80, 448, zh ? '只在所选项目中使用' : 'Available in the selected project', 15, c.muted);
  body += text(425, 423, zh ? '○  个人目录' : '○  Personal', 18, c.ink, 600);
  body += text(425, 448, zh ? '供当前用户跨项目使用' : 'Across projects for the agent user', 15, c.muted);
  body += text(63, 498, '.agents/skills/df-demo-bugfix', 17, c.muted, 500);
  body += rect(63, 520, 679, 42, c.teal, 'none', 9);
  body += text(402, 547, zh ? '3  一键安装到 Codex  →' : '3  Install to Codex  →', 18, '#fff', 650, 'text-anchor="middle"');
  body += arrow(777, 375, 810, 375, c.teal);
  body += rect(824, 175, 336, 405, c.ink);
  body += text(848, 213, zh ? '4  复制命令，在 Agent 中使用' : '4  Copy. Paste. Use it.', zh ? 20 : 24, '#fff', 650);
  body += text(848, 251, zh ? '把命令粘贴到 Codex' : 'Paste into Codex', 17, '#c6d9df');
  body += rect(844, 273, 296, 102, '#28434e', 'none', 9);
  body += text(861, 308, '$df-demo-bugfix', 21, '#9cdeca', 600);
  body += lines(861, 339, zh ? ['按示例说明修复购物车，', '保留测试结果与回归记录。'] : ['Fix the cart in sample/.', 'Keep test and regression evidence.'], zh ? 17 : 15, '#fff', 23);
  body += lines(848, 415, zh ? ['Agent 读取 Skill 后开始任务。', '启用可视化时，首次调用', '会打开实时执行窗口。'] : ['The agent reads the Skill to start.', 'With visualization enabled,', 'the first runtime call opens', 'the live execution view.'], 17, '#c6d9df', 27);
  body += text(848, 550, zh ? '准备一次，每次任务都可复用。' : 'Install once. Reuse for each task.', 16, '#9cdeca', 550);
  body += text(40, 615, zh ? '项目地址自动读取，也可手动选择；一键安装前先确认平台、范围和目录。也支持下载 ZIP。' : 'Projects are discovered automatically, or choose a folder. Confirm the destination, then install. ZIP export is also available.', zh ? 17 : 16, c.muted);
  return frame(zh ? '一键接入' : 'INSTALL & USE', zh ? '选平台、选位置，点击安装就能带走。' : 'Choose an agent. Pick a folder. Install.', zh ? '无需手动整理 Skill 文件；示例以 Codex 为例，Claude Code 和 Copilot 使用同一入口。' : 'No manual Skill packaging. Codex is shown here; Claude Code and Copilot use the same export panel.', 645, body, lang);
}

await mkdir(output, { recursive: true });
for (const lang of ['en', 'zh']) {
  for (const [name, draw] of Object.entries({ 'use-cases': useCases, workflow, install })) {
    await writeFile(resolve(output, `${name}.${lang}.svg`), draw(lang));
  }
}
console.log('Wrote three README diagrams in English and Chinese (6 SVGs).');

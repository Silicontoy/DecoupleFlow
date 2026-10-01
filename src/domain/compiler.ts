import { localizeStaticTemplate } from '../i18n/portable';
import { executionInstructionsEnglish } from '../i18n/executionInstructions';
import { translator, type Language } from '../i18n/translate';
import { strToU8, zipSync } from 'fflate';
import { KIND_LABELS, LOOP_ROLE_LABELS, MachineSchema, TARGETS, driverOf, isBranchState, routingPolicyOf, semanticMachine, type Machine, type Target } from './types';
import { validateMachine } from './validate';
import { compileDiagramSection } from './diagram';
import { runtime } from './runtime';
import { adapterModule, skillAdapterCli } from './adapterExport';
import { skillRunnerSource, executionInstructions } from './skillRunner';
import { skillMonitorSource, skillMonitorHtml } from './skillMonitor';

export const COMPILER_VERSION = '0.5.0';
const table = (text: string) => text.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const quote = (text: string) => text.split('\n').map(line => `> ${line}`).join('\n');
const xml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');


export function compileMarkdown(input: Machine, language: Language = 'zh'): string {
  const tr = translator(language);
  const machine = semanticMachine(input);
  const bullet = (text: string) => text.trim() ? quote(text) : tr('_未填写_');
  const names = new Map(machine.states.map(s => [s.id, s.name]));
  const lines = [
    `# ${machine.name}`, '',
    tr("- 状态机：`{0}`", { "0": machine.id }), tr("- 定义版本：`{0}`", { "0": machine.version }), tr("- 入口：{0}（`{1}`）", { "0": names.get(machine.initialState) ?? tr("未设置"), "1": machine.initialState }), '',
    tr("## 用途"), '', bullet(machine.purpose), '',
    compileDiagramSection(machine, language), '',
    tr("## 推进方式"), '',
    driverOf(machine).type === 'jev' ? tr("使用 Jev（DecoupleFlow 官方 Adapter）判断下一条路径。模型：{0}；最低置信度：{1}；路径与条件最低通过概率：{2}。Agent 或流程平台负责节点业务工作并提供本次证据；Adapter 不确定、质量不通过或外部任务未完成时保留当前状态。", { "0": driverOf(machine).model, "1": driverOf(machine).minConfidence, "2": driverOf(machine).minProbability }) : tr("使用自己的 Agent 读取本定义、检查实际证据并维护状态。无需调用 DecoupleFlow 或其他决策服务。"), '',
    tr("## 使用约定"), '',
    tr("由宿主 Agent 使用本状态机。节点内如何完成工作由 Agent 自主决定；条件满足后，依据已定义的迁移更新当前状态。"), '',
    tr("业务材料和工具由宿主管理。未知条件不等于满足条件；工具请求受理不等于任务完成。仅对迁移显式引用的质量项进行该次跳转的必要检查，其余质量项用于改进结果。"), '',
    tr("子状态机有独立入口；进入子状态机后从内部入口开始，内部结束状态表示返回父状态机，再检查该子状态机节点的出边。记录完整状态路径，避免混淆不同层级。"), '',
    tr("## 状态一览"), '', tr("| ID | 状态 | 类型 | 所属层级 |"), '|---|---|---|---|',
    ...machine.states.map(s => `| \`${s.id}\` | ${table(s.name)} | ${tr(KIND_LABELS[s.kind])} | ${s.parentId ? `\`${s.parentId}\`` : tr("顶层")} |`), '',
    tr("## 跳转一览"), '', tr("| 跳转 ID | 从 | 到 | 条件 | 路径类型 | 必要质量项 |"), '|---|---|---|---|---|---|',
    ...machine.transitions.map(t => `| \`${t.id}\` | ${table(names.get(t.from) ?? t.from)} | ${table(names.get(t.to) ?? t.to)} | ${table(t.condition) || tr("待补充")} | ${t.kind === 'fallback' ? tr("返工 / 异常") : tr("正常")}${t.loopRole ? ` · ${tr(LOOP_ROLE_LABELS[t.loopRole])}` : ''} | ${t.requiredQuality.map(q => `\`${q}\``).join('、') || '—'} |`), '',
  ];
  for (const state of machine.states) {
    lines.push(`## ${state.name} · ${state.id}`, '', tr("类型：{0}{1}", { "0": tr(KIND_LABELS[state.kind]), "1": state.parentId ? tr("；父状态机：`{0}`", { "0": state.parentId }) : '' }), '', tr("### 状态说明"), '', bullet(state.description), '', tr("### 进入条件"), '', bullet(state.entryConditions), '', tr("### 质量条件"), '');
    if (!state.qualityConditions.length) lines.push(tr("未单独定义。"), '');
    for (const q of state.qualityConditions) lines.push(`- \`${q.id}\` · ${q.required ? tr("迁移检查项") : tr("改进建议")}：${table(q.text)}`, '');
    if (state.kind === 'list') {
      lines.push(tr("### 按序事项"), '', ...(state.list?.items ?? []).map((item, index) => `${index + 1}. \`${item.id}\` · ${table(item.text) || tr("待填写事项")}`), '', tr("### 统一通过条件"), '', bullet(state.list?.passCondition ?? ''), '', tr("按列表顺序处理，每项都重新检查统一通过条件和本状态的必要质量项；未通过或不确定时停留在当前项。全部事项通过后才检查出口条件。暂停与恢复保留当前项，重新进入本状态从第一项开始。"), '');
    }
    if (state.kind === 'subflow') lines.push(tr("内部入口：`{0}`。内部结束后返回本状态，再判断对外跳转。", { "0": state.initialState }), '');
    if (state.kind === 'end') lines.push(tr("结束结果：{0}。{1}", { "0": state.outcome, "1": state.parentId ? tr("返回父状态机。") : tr("结束当前任务实例。") }), '');
    if (isBranchState(state)) {
      lines.push(tr("### 进入路径"), '', tr("任一入路满足条件后可以到达此节点；每次到达后重新判断出路。"), '');
      for (const t of machine.transitions.filter(t => t.to === state.id)) lines.push(tr("- 来自 **{0}**，迁移 `{1}`：{2}", { "0": table(names.get(t.from) ?? t.from), "1": t.id, "2": table(t.condition) || tr("条件待补充") }), '');
      if (machine.initialState === state.id || machine.states.some(s => s.initialState === state.id)) lines.push(tr("此节点同时是当前层级的入口。"), '');
      lines.push(tr("### 分支选择策略"), '', bullet(state.routingPolicy?.trim() || tr(routingPolicyOf(state))), '');
    }
    if (state.kind === 'loop') lines.push(tr("### 循环规则"), '', tr("进入循环节点时检查继续与退出条件。继续条件成立后进入对应目标，完成本轮后沿已定义的返回路径回到此节点；每轮重新检查条件与质量项。退出条件明确满足后，沿对应退出路径进入下一状态。循环次数、实际工作与等待由宿主 Agent 管理。"), '');
    for (const [label, content] of [[tr("工具调用说明"), state.toolGuidance], [tr("配置说明"), state.configuration], [tr("当前状态的处理策略"), state.strategies.during], [tr("失败时的处理"), state.strategies.onFailure], [tr("无法判断时"), state.strategies.onUncertain]]) lines.push(`### ${label}`, '', bullet(content), '');
    lines.push(tr("### 下个步骤"), '');
    const outgoing = machine.transitions.filter(t => t.from === state.id);
    if (!outgoing.length) lines.push(state.kind === 'end' ? tr("这是结束状态。") : tr("尚未定义。遇到缺口时保留当前状态并说明情况。"), '');
    for (const t of outgoing) lines.push(tr("- **{0}**（`{1}`），迁移 `{2}`", { "0": names.get(t.to) ?? t.to, "1": t.to, "2": t.id }), tr("  - 条件：{0}", { "0": table(t.condition) || tr("待补充") }), tr("  - 路径类型：{0}", { "0": t.kind === 'fallback' ? tr("返工 / 异常") : tr("正常") }), ...(t.loopRole ? [tr("  - 循环路径：{0}", { "0": tr(LOOP_ROLE_LABELS[t.loopRole]) })] : []), tr("  - 必要质量项：{0}", { "0": t.requiredQuality.join('、') || tr("无额外引用") }), tr("  - 不确定时：{0}", { "0": table(t.onUncertain) || tr("保留当前状态，补充信息。") }), '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

export function compileXml(input: Machine, language: Language = 'zh'): string {
  const tr = translator(language);
  const machine = semanticMachine(input);
  const lines = [`<StateMachine id="${xml(machine.id)}" version="${xml(machine.version)}" initial="${xml(machine.initialState)}">`, `  <Name>${xml(machine.name)}</Name>`, `  <Purpose>${xml(machine.purpose)}</Purpose>`];
  const driver = driverOf(machine);
  lines.push(`  <Driver type="${driver.type}"${driver.type === 'jev' ? ` model="${xml(driver.model)}" minConfidence="${driver.minConfidence}" minProbability="${driver.minProbability}"` : ''} />`);
  for (const s of machine.states) {
    lines.push(`  <Step id="${s.id}" name="${xml(s.name)}" kind="${s.kind}"${s.parentId ? ` parent="${s.parentId}"` : ''}>`, `    <Meaning>${xml(s.description)}</Meaning>`, `    <Entry>${xml(s.entryConditions)}</Entry>`);
    if (s.kind === 'subflow') lines.push(`    <Submachine initial="${s.initialState}" />`);
    if (s.kind === 'end') lines.push(`    <End outcome="${s.outcome}" />`);
    if (s.kind === 'list') {
      lines.push('    <List order="sequential" exit="all-items-passed" reentry="restart">', `      <PassCondition>${xml(s.list?.passCondition ?? '')}</PassCondition>`);
      (s.list?.items ?? []).forEach((item, index) => lines.push(`      <Item id="${item.id}" position="${index + 1}">${xml(item.text)}</Item>`));
      lines.push(`      <RequiredQuality>${s.qualityConditions.filter(q => q.required).map(q => q.id).join(' ')}</RequiredQuality>`, '    </List>');
    }
    if (isBranchState(s)) lines.push(`    <RoutingPolicy>${xml(s.routingPolicy?.trim() || tr(routingPolicyOf(s)))}</RoutingPolicy>`);
    if (s.kind === 'loop') lines.push(tr("    <Loop>继续条件成立时进入本轮目标，沿已定义路径返回后重新检查；退出条件成立时进入退出目标。</Loop>"));
    s.qualityConditions.forEach(q => lines.push(`    <Quality id="${q.id}" role="${q.required ? 'transition-condition' : 'suggestion'}">${xml(q.text)}</Quality>`));
    lines.push(`    <ToolGuidance>${xml(s.toolGuidance)}</ToolGuidance>`, `    <Configuration>${xml(s.configuration)}</Configuration>`, `    <Strategy>${xml(s.strategies.during)}</Strategy>`, `    <Fallback on="failure">${xml(s.strategies.onFailure)}</Fallback>`, `    <Fallback on="uncertain">${xml(s.strategies.onUncertain)}</Fallback>`);
    machine.transitions.filter(t => t.from === s.id).forEach(t => lines.push(`    <Condition id="${t.id}" next="${t.to}" quality="${t.requiredQuality.join(' ')}" kind="${t.kind}"${t.loopRole ? ` loopRole="${t.loopRole}"` : ''}>`, `      <When>${xml(t.condition)}</When>`, `      <OnUncertain>${xml(t.onUncertain)}</OnUncertain>`, '    </Condition>'));
    lines.push('  </Step>');
  }
  return [...lines, '</StateMachine>', ''].join('\n');
}

export async function hashText(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export type Bundle = { skillName: string; files: Record<string, string>; semanticHash: string; language?: Language };

export async function buildSkillBundle(input: Machine, language: Language = 'zh'): Promise<Bundle> {
  const tr = translator(language);
  const machine = semanticMachine(MachineSchema.parse(input));
  const errors = validateMachine(machine, language).filter(d => d.level === 'error');
  if (errors.length) throw new Error(errors.map(d => d.message).join('\n'));
  const skillName = `df-${machine.id}`;
  const machineJson = JSON.stringify(machine, null, 2) + '\n';
  const semanticHash = await hashText(machineJson);
  const description = tr("使用「{0}」状态机识别当前位置、检查跳转与质量条件，并维护任务状态。用户要求使用或恢复此流程时使用。", { "0": machine.name });
  const instruction = [
    '---', `name: ${skillName}`, `description: ${JSON.stringify(description)}`, 'metadata:', '  generator: "DecoupleFlow"', `  decoupleflow-id: ${JSON.stringify(machine.id)}`, `  decoupleflow-version: ${JSON.stringify(machine.version)}`, '---', '', `# ${machine.name}`, '',
    tr("这是供现有 Agent 使用的状态机模块。读取状态说明，使用你已有的能力完成任务，并根据实际证据维护正确的状态跳转。"), '',
    tr("## 先读取定义"), '',
    tr("- [状态机总文档](references/state-machine.md)：完整 Mermaid 状态图，以及各状态、跳转条件、质量和节点策略。"),
    tr("- [结构化定义](references/state-machine.json)：核对状态 ID、层级和迁移引用。"),
    tr("- [标签描述](references/state-machine.xml)：同一份定义的结构化文本。"),
    tr("- [状态记录模板](assets/state-record.template.json)：当前任务使用的记录格式。"), '',
    tr("## 每次调用"), '',
    tr("- 先读取 [实例与实时展示](references/execution.md)，用 `scripts/run.mjs start --workspace <当前任务工作区绝对路径>` 创建本次实例。开启展示时会自动打开实时窗口；使用助手上报实际事件与提交迁移，避免界面与状态记录脱节。"),
    tr("- 新任务始终 start；仅在用户明确继续某个未完成任务时 resume 并指定原实例目录。完成后自动归档，不能再次使用旧实例继续新任务。不要把任务状态写进 Skill 安装目录。"),
    tr("- 使用返回的 handoff 查看当前状态目标、进入条件、质量、工具和策略。用宿主已有工具自主完成工作，再按 decisionFormat 提交本次证据与条件结论。只记录检查结论、证据引用与简要依据。"),
    tr("- 不能确认条件时保持状态，按策略核实或等待。多个条件冲突或未定义路径时指出缺口，不把未知条件当作通过。"),
    tr("- 外部工具受理不等于完成。保留原任务标识，先查询原任务，不因超时重复提交。无法自动唤醒时记录待办，之后显式 resume。"),
    tr("- 子状态机通过 __enter__ 进入、__return__ 返回父层，再判断父层出路；顶层结束状态经 __finish__ 确认后归档。以助手返回的候选路径为准。定义固定在实例目录中，不静默替换进行中版本。"), '',
    tr("## 条件判断与循环"), '',
    tr("判断与循环节点支持多条入路和出路。每次从任一入路到达后，结合到达路径与当前上下文，按节点的分支选择策略检查各条出路；只有条件、必要质量项与目标进入条件均成立时才沿对应路径迁移。没有匹配或条件不确定时保留当前状态；多项同时满足时遵循显式的选择策略，策略未说明则核实或澄清。"), '',
    tr("循环节点通过 loopRole=continue 的路径进入本轮工作，完成后沿定义中的返回路径回到循环节点，重新检查本轮条件；通过 loopRole=exit 的路径退出。记录实际经过的迁移与每轮结果，不把上轮的通过结论直接用于本轮。"), '',
    ...(machine.states.some(state => state.kind === 'list') ? [tr("## 列表状态"), '', tr("按列表顺序处理，每项都重新检查统一通过条件和本状态的必要质量项；未通过或不确定时停留在当前项。全部事项通过后才检查出口条件。暂停与恢复保留当前项，重新进入本状态从第一项开始。"), '', tr("读取 handoff.listProgress 确认当前事项，只提交助手返回的当前事项候选 ID（__item__ 开头）；每次 advance 仅确认一个事项，证据仅用于本项。最后一项通过后，重新读取候选出口并检查出口条件，不把逐项通过视为自动离开状态。"), ''] : []),
    tr("## 能力边界"), '',
    tr("Skill 提供说明与状态记录约定，不创建工具连接、不授予权限，也不提供后台调度。缺少工具或材料时说明缺口。遵循宿主与用户的现有指令。"), '',
  ].join('\n');
  const files: Record<string, string> = {
    'SKILL.md': instruction,
    'references/execution.md': language === 'en' ? executionInstructionsEnglish : executionInstructions,
    'scripts/run.mjs': localizeStaticTemplate(skillRunnerSource, language),
    'scripts/monitor.mjs': localizeStaticTemplate(skillMonitorSource, language),
    'scripts/adapter.mjs': adapterModule(language),
    'assets/execution.html': localizeStaticTemplate(skillMonitorHtml, language),
    'references/state-machine.md': compileMarkdown(machine, language),
    'references/state-machine.json': machineJson,
    'references/state-machine.xml': compileXml(machine, language),
    'assets/state-record.template.json': JSON.stringify(runtime.initialRecord(machine, semanticHash, ''), null, 2) + '\n',
    'README.md': tr("# {0}\n\n由 DecoupleFlow {1} 生成的独立状态机 Skill。\n\n将整个 `{2}` 目录放入宿主的技能目录，在宿主中显式调用技能。关闭 DecoupleFlow 后仍可使用。\n\n- Codex：个人的 `~/.agents/skills/` 或目标项目的 `.agents/skills/`；使用 `${3}`。\n- Claude Code：个人的 `~/.claude/skills/` 或目标项目的 `.claude/skills/`；使用 `/{4}`。\n- GitHub Copilot：个人的 `~/.copilot/skills/` 或目标项目的 `.github/skills/`；请求使用 `{5}` 技能。\n\n状态机定义版本：{6}。外部工具、权限、上下文和等待能力由宿主提供。\n", { "0": machine.name, "1": COMPILER_VERSION, "2": skillName, "3": skillName, "4": skillName, "5": skillName, "6": machine.version }),
  };
  if (driverOf(machine).type === 'jev') {
    files['scripts/decide.mjs'] = localizeStaticTemplate(skillAdapterCli, language);
    files['README.md'] += tr("\n独立 Jev 底层接口也保留在 scripts/decide.mjs；日常运行使用 run.mjs advance，可自动记录实例和更新展示。\n");
  }
  files['README.md'] += tr("\n运行与可视化请参见 references/execution.md。新任务 start，未完成任务 resume，完成后自动归档。需要 Node.js 18.18+。\n");
  const hashes = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([path, text]) => [path, await hashText(text)])));
  files['decoupleflow-manifest.json'] = JSON.stringify({ generator: 'DecoupleFlow', compilerVersion: COMPILER_VERSION, language, skillName, machineId: machine.id, machineVersion: machine.version, semanticHash, files: hashes }, null, 2) + '\n';
  return { skillName, files, semanticHash, language };
}

export function bundleZip(bundle: Bundle, target: Target, scope: 'project' | 'personal' = 'project'): Uint8Array {
  const base = scope === 'personal' ? TARGETS[target].personalDirectory : TARGETS[target].directory;
  const root = `${base ? base + '/' : ''}${bundle.skillName}`;
  const archive: Record<string, [Uint8Array, { mtime: Date }]> = {};
  for (const path of Object.keys(bundle.files).sort()) archive[`${root}/${path}`] = [strToU8(bundle.files[path]), { mtime: new Date(2020, 0, 1) }];
  return zipSync(archive, { level: 6 });
}

import { translator, type Language } from '../i18n/translate';
import { newState, type Project, type State, type Transition } from './types';
import { createDemo, DEMO_IDS, DEMO_TEMPLATES, type DemoId } from './demos';

function state(id: string, name: string, kind: State['kind'], description: string, overrides: Partial<State> = {}): State {
  return { ...newState(kind, id, name), description, ...overrides };
}
function edge(id: string, from: string, to: string, condition: string, kind: Transition['kind'] = 'normal', quality: string[] = []): Transition {
  return { id, from, to, condition, kind, requiredQuality: quality, onUncertain: '保留当前状态，核实条件后再决定。' };
}
export type TemplateId = 'analysis' | 'review' | 'simple' | 'blank' | 'loop' | DemoId;
export const TEMPLATES: { id: TemplateId; name: string; description: string; count: string }[] = [
  ...DEMO_TEMPLATES,
  { id: 'analysis', name: '外部分析与评审', description: '工具提交、外部等待、质量检查与问题处理', count: '6 个状态' },
  { id: 'review', name: '草稿评审与修订', description: '准备草稿，收集意见，逐步修改直到交付', count: '4 个状态' },
  { id: 'simple', name: '顺序工作流', description: '从准备到完成，建立你的第一份状态机', count: '3 个状态' },
  { id: 'blank', name: '空白状态机', description: '从一张空白画布开始定义你的工作方法', count: '自由创建' },
  { id: 'loop', name: '循环与条件分支', description: '继续与退出循环，三条入路汇入判断，再按条件选择路径', count: '8 个状态' },
];

function createTemplateDefinition(template: TemplateId = 'analysis'): Project {
  let states: State[], transitions: Transition[], initialState: string, name: string, id: string, purpose: string;
  let layout: Project['layout'] = {};
  if (template === 'analysis') {
    name = '外部分析与评审'; id = 'analysis-review'; purpose = '让 Agent 正确处理外部分析任务：提交后等待真实结果，检查质量，再完成交付或处理问题。'; initialState = 'prepare';
    states = [
      state('prepare', '准备分析', 'task', '整理需求与材料，向宿主已有的分析工具提交任务。', { entryConditions: '已明确本次分析目标，且已有可使用的材料。', toolGuidance: '使用宿主已有的外部分析工具。确认受理后记录任务 ID，避免重复提交。', qualityConditions: [{ id: 'accepted', text: '请求已受理，并取得外部任务标识。', required: true }], strategies: { during: '确认材料和目标，再组织工具参数。', onFailure: '先查看提交结果，确认未受理后再考虑重试。', onUncertain: '无法确认提交结果时先查询，不重复提交。' } }),
      state('waiting', '等待外部结果', 'wait', '保留任务标识，等待原分析任务返回可用结果。', { entryConditions: '分析请求已被受理，任务 ID 已记录。', toolGuidance: '使用宿主的任务查询能力，查询原任务；若宿主支持回调，可使用其事件通知。', configuration: '建议查询间隔：30 秒。\n任务关联：沿用原任务 ID。', qualityConditions: [{ id: 'matching-result', text: '结果属于当前任务，且内容能够读取。', required: true }], strategies: { during: '可以整理不依赖分析结果的提纲。宿主无法自动唤醒时，记录待恢复事项。', onFailure: '明确失败后进入问题处理；超时本身不表示失败。', onUncertain: '保留等待状态，核实任务进展；不假定已经完成。' } }),
      state('review', '检查结果质量', 'decision', '检查分析结果是否覆盖关键问题，并核对结论来源。', { qualityConditions: [{ id: 'coverage', text: '关键问题均有回答，结论能关联到来源。', required: true }, { id: 'clarity', text: '清楚标明尚未解决的问题。', required: false }], strategies: { during: '按质量条件逐项检查，给出简要结论和依据。', onFailure: '说明具体质量缺口，进入问题处理。', onUncertain: '必要时补充核对，不把未知标记为合格。' } }),
      state('problem', '处理问题', 'task', '根据错误或质量缺口调整材料，决定重新发起或停止。', { strategies: { during: '先确认问题来源。重新发起前确认旧任务已结束或不会重复产生副作用。', onFailure: '说明无法解决的原因，询问用户是否停止。', onUncertain: '保留问题记录，补充信息后决定。' } }),
      state('done', '完成交付', 'end', '交付已检查的分析结果，并附来源和未解决事项。'),
      state('stopped', '结束本次任务', 'end', '保留已有结果与停止原因，结束本次任务。', { outcome: 'stopped' }),
    ];
    transitions = [edge('submitted', 'prepare', 'waiting', '请求已受理', 'normal', ['accepted']), edge('ready', 'waiting', 'review', '结果已返回', 'normal', ['matching-result']), edge('approved', 'review', 'done', '质量检查通过', 'normal', ['coverage']), edge('not-ready', 'review', 'problem', '需要补充或修改', 'fallback'), edge('failed', 'waiting', 'problem', '外部任务明确失败', 'fallback'), edge('retry', 'problem', 'prepare', '问题已修正，重新发起', 'fallback'), edge('stop', 'problem', 'stopped', '决定停止任务', 'fallback')];
    layout = { prepare: { x: 30, y: 70 }, waiting: { x: 370, y: 70 }, review: { x: 710, y: 70 }, done: { x: 710, y: 370 }, problem: { x: 370, y: 370 }, stopped: { x: 30, y: 370 } };
  } else if (template === 'review') {
    name = '草稿评审与修订'; id = 'draft-review'; purpose = '基于需求形成草稿，等待真实评审意见，修改后再次检查。'; initialState = 'draft';
    states = [state('draft', '准备草稿', 'task', '依据需求形成可评审的草稿。'), state('feedback', '等待评审意见', 'wait', '等待用户或评审者给出明确意见。', { strategies: { during: '可以准备补充材料。', onFailure: '说明缺少评审意见。', onUncertain: '不代替评审者批准。' } }), state('revise', '修改草稿', 'task', '对照评审意见逐项修改，并标注处理结果。'), state('done', '交付定稿', 'end', '交付已经被接受的版本。')];
    transitions = [edge('to-review', 'draft', 'feedback', '已有可评审草稿'), edge('changes', 'feedback', 'revise', '评审要求修改', 'fallback'), edge('again', 'revise', 'feedback', '已回应评审意见'), edge('accepted', 'feedback', 'done', '评审者明确接受')];
  } else if (template === 'loop') {
    name = '循环与条件分支'; id = 'loop-and-routing'; purpose = '逐项处理任务，每轮按质量与资料条件选择路径，直到全部完成或用户停止。'; initialState = 'prepare';
    states = [
      state('prepare', '准备待办项', 'task', '明确待处理项目及每项的完成要求。'),
      state('repeat', '检查是否继续', 'loop', '每轮检查剩余事项与停止要求，决定继续处理或退出。', { routingPolicy: '用户明确要求停止时优先进入停止路径；否则，全部完成时交付，仍有待办时继续。证据不足时保留当前状态并核实。' }),
      state('work', '处理当前项', 'task', '选取一个待办项，使用宿主能力完成处理。'),
      state('review', '判断当前结果', 'decision', '根据资料完整度和本项质量检查选择对应路径。', { qualityConditions: [{ id: 'item-approved', text: '资料完整，本项质量达到要求。', required: true }] }),
      state('revise', '修订当前项', 'task', '按质量缺口修订，然后重新判断。'),
      state('clarify', '补充资料', 'wait', '等待或取得缺少的资料，然后重新判断。', { strategies: { during: '说明缺少的资料，使用宿主能力等待补充。', onFailure: '保留缺口并说明原因。', onUncertain: '继续核实，保留当前状态。' } }),
      state('done', '全部交付', 'end', '交付全部已完成的项目与结果。'),
      state('stopped', '停止处理', 'end', '保留已完成结果和未完成项目。', { outcome: 'stopped' }),
    ];
    transitions = [
      edge('start', 'prepare', 'repeat', '待办项目和要求已明确'),
      { ...edge('continue', 'repeat', 'work', '仍有待办项，且用户未要求停止'), loopRole: 'continue' },
      { ...edge('finish', 'repeat', 'done', '全部项目已通过质量检查'), loopRole: 'exit' },
      { ...edge('stop', 'repeat', 'stopped', '用户明确要求停止'), loopRole: 'exit' },
      edge('processed', 'work', 'review', '当前项已有可检查的结果'),
      edge('passed', 'review', 'repeat', '资料完整且质量通过，本项已标记完成', 'normal', ['item-approved']),
      edge('missing', 'review', 'clarify', '缺少必要资料'),
      edge('changes', 'review', 'revise', '资料完整，但质量尚未通过', 'fallback'),
      edge('supplemented', 'clarify', 'review', '缺少的资料已补齐'),
      edge('revised', 'revise', 'review', '本轮修订已完成'),
    ];
    layout = { prepare: { x: 30, y: 70 }, repeat: { x: 390, y: 70 }, work: { x: 820, y: 70 }, review: { x: 1190, y: 70 }, done: { x: 390, y: 470 }, stopped: { x: 390, y: 720 }, revise: { x: 820, y: 470 }, clarify: { x: 1220, y: 470 } };
  } else if (template === 'simple') {
    name = '顺序工作流'; id = 'simple-flow'; purpose = '描述从准备到交付的工作状态，让 Agent 理解每一步的条件。'; initialState = 'prepare';
    states = [state('prepare', '准备材料', 'task', '明确目标，确认当前材料。'), state('work', '处理任务', 'task', '使用宿主能力完成任务，检查结果。'), state('done', '完成', 'end', '交付满足要求的结果。')];
    transitions = [edge('prepared', 'prepare', 'work', '目标明确，材料可用'), edge('completed', 'work', 'done', '结果达到交付要求')];
  } else {
    name = '未命名状态机'; id = 'untitled-machine'; purpose = ''; initialState = ''; states = []; transitions = [];
  }
  states.forEach((s, i) => { layout[s.id] ??= { x: 50 + i % 3 * 340, y: 90 + Math.floor(i / 3) * 230 }; });
  return { format: 'decoupleflow-project', schemaVersion: 1, machine: { schemaVersion: 1, id, name, version: '1.0.0', purpose, initialState, states, transitions }, layout };
}

/** Localize a newly created example; saved and imported content is never translated. */
export function createTemplate(template: TemplateId = 'analysis', language: Language = 'zh'): Project {
  if ((DEMO_IDS as readonly string[]).includes(template)) return createDemo(template as DemoId, language);
  const project = createTemplateDefinition(template);
  const tr = translator(language);
  const localize = (value: unknown): unknown => {
    if (typeof value === 'string') return tr(value);
    if (Array.isArray(value)) return value.map(localize);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(item)]));
    return value;
  };
  return language === 'zh' ? project : localize(project) as Project;
}

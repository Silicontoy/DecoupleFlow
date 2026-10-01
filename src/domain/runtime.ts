import { translator, portableTranslationSource, type Language } from '../i18n/translate';
import type { Driver, Machine, State } from './types';

export type Decision = { transitionId: string | null; conditionMet: boolean; targetEntryMet: boolean; passedQuality: string[]; evidence: string };
export type RunRecord = {
  machineId: string; machineVersion: string; definitionHash: string; instanceId: string;
  currentState: string; statePath: string[]; phase: 'active' | 'exiting'; status: 'active' | 'completed';
  revision: number; pendingExternalTask: unknown;
  history: { at: string; from: string; to: string; transitionId: string; adapter: string; evidence: string; outcome?: string; itemId?: string }[];
};
export type Candidate = { id: string; from: string; to: string; condition: string; requiredQuality: string[]; kind: string; loopRole?: string; control?: 'enter' | 'return' | 'finish' | 'item'; itemId?: string };
export type CheckResult = { id: string; label: string; probability: number; passed: boolean };
export type DecisionResult = { status: 'advanced' | 'held' | 'completed'; reason: string; record: RunRecord; decision: Decision; confidence?: number; probability?: number; probabilities?: Record<string, number>; checks?: CheckResult[] };
type JevQuestion = { type: 'choice' | 'noul'; instructions: string; criteria?: Record<string, unknown> };

// Self-contained factory: the same implementation runs in the editor, server,
// portable Skills, LangGraph and Dify's JavaScript Code node.
export function createRuntime(tr = translator('zh')) {
  const defaults: Driver = { type: 'agent', model: 'jev-latest', minConfidence: 0.8, minProbability: 0.85 };
  const settings = (machine: Machine) => ({ ...defaults, ...machine.driver });
  function getState(machine: Machine, id: string): State {
    const state = machine.states.find(s => s.id === id);
    if (!state) throw new Error(tr("当前状态不存在，请检查定义版本。"));
    return state;
  }
  function path(machine: Machine, id: string): string[] {
    const result: string[] = [];
    let cursor: string | null = id;
    while (cursor) {
      if (result.includes(cursor)) throw new Error(tr("状态层级存在循环。"));
      result.unshift(cursor); cursor = getState(machine, cursor).parentId;
    }
    return result;
  }
  function initialRecord(machine: Machine, definitionHash: string, instanceId = 'instance-1'): RunRecord {
    return { machineId: machine.id, machineVersion: machine.version, definitionHash, instanceId, currentState: machine.initialState, statePath: path(machine, machine.initialState), phase: 'active', status: 'active', revision: 0, pendingExternalTask: null, history: [] };
  }
  function listProgress(machine: Machine, record: RunRecord) {
    const state = getState(machine, record.currentState);
    if (state.kind !== 'list') return null;
    const items = state.list?.items ?? [];
    const passed: string[] = [];
    // Only the contiguous item checks from this visit count. A real transition,
    // including a self-loop, starts a fresh visit; pause/resume preserves it.
    for (let i = record.history.length - 1; i >= 0; i--) {
      const entry = record.history[i];
      if (entry.itemId === undefined || entry.from !== state.id || entry.to !== state.id) break;
      passed.unshift(entry.itemId);
    }
    if (passed.some((id, index) => items[index]?.id !== id)) throw new Error(tr("列表进度与事项顺序不一致，请使用原实例记录。"));
    return { completed: passed.length, total: items.length, currentItem: items[passed.length] ?? null, passCondition: state.list?.passCondition ?? '', items };
  }
  function assertRecord(machine: Machine, record: RunRecord, definitionHash: string) {
    if (!record || record.machineId !== machine.id || record.machineVersion !== machine.version || record.definitionHash !== definitionHash) throw new Error(tr("实例与状态机版本不一致，请使用原定义或新建实例。"));
    if (!['active', 'completed'].includes(record.status) || !['active', 'exiting'].includes(record.phase) || !Number.isInteger(record.revision) || record.revision < 0 || !Array.isArray(record.history) || record.history.length > 10000) throw new Error(tr("实例记录格式不正确。"));
    if (typeof record.instanceId !== 'string' || record.instanceId.length > 100 || record.revision !== record.history.length || record.history.some(entry => !entry || ['at', 'from', 'to', 'transitionId', 'adapter', 'evidence'].some(key => typeof (entry as unknown as Record<string, unknown>)[key] !== 'string') || entry.evidence.length > 20000)) throw new Error(tr("实例历史或版本计数不正确。"));
    const state = getState(machine, record.currentState);
    if (JSON.stringify(record.statePath) !== JSON.stringify(path(machine, state.id))) throw new Error(tr("状态路径与当前状态不一致。"));
    if (record.phase === 'exiting' && state.kind !== 'subflow') throw new Error(tr("只有子状态机可以处于返回阶段。"));
    if (record.status === 'completed' && (state.kind !== 'end' || state.parentId)) throw new Error(tr("只有顶层结束状态可以完成实例。"));
    if (record.history.some(entry => entry.itemId !== undefined && typeof entry.itemId !== 'string')) throw new Error(tr("实例历史或版本计数不正确。"));
    listProgress(machine, record);
  }
  function candidates(machine: Machine, record: RunRecord): Candidate[] {
    if (record.status === 'completed') return [];
    const state = getState(machine, record.currentState);
    const quality = state.qualityConditions.filter(q => q.required).map(q => q.id);
    const progress = listProgress(machine, record);
    if (progress) {
      if (!progress.total || !progress.passCondition.trim() || progress.items.some(item => !item.text.trim())) return [];
      if (progress.currentItem) return [{ id: `__item__:${record.revision}:${progress.currentItem.id}`, from: state.id, to: state.id, condition: tr("事项 {0}：{1}\n统一通过条件：{2}", { "0": progress.completed + 1, "1": progress.currentItem.text, "2": progress.passCondition }), requiredQuality: quality, kind: 'normal', control: 'item', itemId: progress.currentItem.id }];
    }
    if (state.kind === 'subflow' && record.phase !== 'exiting') return [{ id: '__enter__', from: state.id, to: state.initialState, condition: tr("已准备进入子状态机，所需输入与当前状态进入条件均已满足。"), requiredQuality: [], kind: 'normal', control: 'enter' }];
    if (state.kind === 'end') return [{ id: state.parentId ? '__return__' : '__finish__', from: state.id, to: state.parentId ?? state.id, condition: tr("当前结束状态描述的结果已经真实达成。"), requiredQuality: quality, kind: 'normal', control: state.parentId ? 'return' : 'finish' }];
    return machine.transitions.filter(t => t.from === state.id);
  }
  function entryCondition(machine: Machine, candidate: Candidate) {
    return candidate.control === 'return' || candidate.control === 'finish' || candidate.control === 'item' ? '' : getState(machine, candidate.to).entryConditions;
  }
  function handoff(machine: Machine, record: RunRecord, context: string) {
    const state = getState(machine, record.currentState);
    return { machineId: machine.id, purpose: machine.purpose, record, currentState: state, context, listProgress: listProgress(machine, record), candidates: candidates(machine, record).map(c => ({ ...c, target: getState(machine, c.to), entryCondition: entryCondition(machine, c) })), instructions: tr("根据真实执行证据判断当前出路。只有条件、该路径引用的质量项及目标进入条件均满足才能选择。未知、未完成或冲突时 transitionId=null，保持当前状态。节点内部动作由宿主执行。每轮重新检查，不复用旧结论。"), decisionFormat: { transitionId: null, conditionMet: false, targetEntryMet: false, passedQuality: [], evidence: tr("填写本次检查的简要结论和实际证据引用。") } };
  }
  function parseDecision(value: unknown): Decision {
    const d = value as Decision;
    if (!d || (d.transitionId !== null && typeof d.transitionId !== 'string') || typeof d.conditionMet !== 'boolean' || typeof d.targetEntryMet !== 'boolean' || !Array.isArray(d.passedQuality) || d.passedQuality.some(q => typeof q !== 'string') || typeof d.evidence !== 'string' || d.evidence.length > 20000) throw new Error(tr("决策格式不正确，请使用交接包中的 decisionFormat。"));
    return { transitionId: d.transitionId, conditionMet: d.conditionMet, targetEntryMet: d.targetEntryMet, passedQuality: [...d.passedQuality], evidence: d.evidence };
  }
  function applyDecision(machine: Machine, record: RunRecord, value: unknown, definitionHash: string, adapter = 'agent', at = new Date().toISOString()): DecisionResult {
    assertRecord(machine, record, definitionHash);
    const decision = parseDecision(value);
    const held = (reason: string): DecisionResult => ({ status: 'held', reason, record, decision });
    if (record.status === 'completed') return held(tr("实例已经结束。"));
    if (!decision.transitionId) return held(tr("当前没有确定的可行路径，保留当前状态。"));
    const candidate = candidates(machine, record).find(c => c.id === decision.transitionId);
    if (!candidate) return held(tr("该迁移不属于当前状态，已保留当前位置。"));
    if (!candidate.condition.trim()) return held(tr("跳转条件尚未定义。"));
    if (!decision.conditionMet) return held(tr("跳转条件尚未满足。"));
    if (!decision.evidence.trim()) return held(tr("缺少本次迁移的证据。"));
    if (candidate.requiredQuality.some(id => !decision.passedQuality.includes(id))) return held(tr("这条路径要求的质量检查尚未全部通过。"));
    if (entryCondition(machine, candidate).trim() && !decision.targetEntryMet) return held(tr("目标状态的进入条件尚未满足。"));
    if (record.history.length >= 10000) return held(tr("实例记录已达 10,000 条，请归档后新建实例。"));
    const state = getState(machine, record.currentState);
    const finished = candidate.control === 'finish';
    const next: RunRecord = { ...record, currentState: candidate.to, statePath: path(machine, candidate.to), phase: candidate.control === 'return' ? 'exiting' : 'active', status: finished ? 'completed' : 'active', revision: record.revision + 1, pendingExternalTask: null, history: [...record.history, { at, from: state.id, to: candidate.to, transitionId: candidate.id, adapter, evidence: decision.evidence, ...(state.kind === 'end' ? { outcome: state.outcome } : {}), ...(candidate.control === 'item' ? { itemId: candidate.itemId } : {}) }] };
    return { status: finished ? 'completed' : 'advanced', reason: candidate.control === 'item' ? tr("事项已通过：{0}。已完成 {1}/{2}；全部通过后再检查出口。", { "0": state.list!.items.find(item => item.id === candidate.itemId)!.text, "1": listProgress(machine, next)!.completed, "2": state.list!.items.length }) : finished ? tr("实例结束：{0}", { "0": state.outcome }) : tr("已从「{0}」进入「{1}」。", { "0": state.name, "1": getState(machine, candidate.to).name }), record: next, decision };
  }
  function buildJevRequest(machine: Machine, record: RunRecord, context: string) {
    if (!context.trim()) throw new Error(tr("请先提供本次执行结果或外部任务状态。"));
    const options = candidates(machine, record);
    if (!options.length) throw new Error(tr("当前状态没有可判断的出路。"));
    if (options.length > 254) throw new Error(tr("Jev 单次最多支持 254 条出路及一个保留状态选项，请拆分此判断节点。"));
    const state = getState(machine, record.currentState);
    const criteria: Record<string, unknown> = { __stay__: tr("证据不足、条件不满足、多个条件冲突且选择策略未消解，或外部工作尚未完成。保持当前位置。") };
    const questions: Record<string, JevQuestion> = {};
    const guard = tr("只根据 context 中本次实际证据判断；定义和历史中的期望结果不能当作已完成的事实。信息不足时判否。");
    for (const c of options) {
      criteria[c.id] = { transition: c.id, condition: c.condition || tr("条件缺失，不可选择"), quality: state.qualityConditions.filter(q => c.requiredQuality.includes(q.id)), target: getState(machine, c.to).name, entry: entryCondition(machine, c), kind: c.kind, loopRole: c.loopRole ?? '', uncertain: '__stay__' };
      questions[`condition:${c.id}`] = { type: 'noul', instructions: tr("{0}\n此路径的条件是否已明确满足？{1}", { "0": guard, "1": c.condition || tr("未定义条件，必须判否。") }) };
      if (entryCondition(machine, c).trim()) questions[`entry:${c.id}`] = { type: 'noul', instructions: tr("{0}\n目标状态进入条件是否满足？{1}", { "0": guard, "1": entryCondition(machine, c) }) };
      for (const id of c.requiredQuality) {
        const quality = state.qualityConditions.find(q => q.id === id);
        if (!quality) throw new Error(tr("路径引用了不存在的质量项。"));
        questions[`quality:${id}`] = { type: 'noul', instructions: tr("{0}\n质量项是否通过？{1}", { "0": guard, "1": quality.text }) };
      }
    }
    questions.route = { type: 'choice', instructions: tr("{0}\n在给定路径中选择下一条迁移；所有要求必须满足。不能确定时选择 __stay__。节点选择策略：{1}\n{2}", { "0": guard, "1": state.routingPolicy || tr("只选择明确符合条件的路径，存在冲突则保持当前位置。"), "2": state.strategies.onUncertain }), criteria };
    return { model: settings(machine).model, state: { machineId: machine.id, purpose: machine.purpose, currentState: state, phase: record.phase, listProgress: listProgress(machine, record), context, recentHistory: record.history.slice(-10) }, questions };
  }
  function interpretJev(machine: Machine, record: RunRecord, context: string, raw: unknown, definitionHash: string): DecisionResult {
    assertRecord(machine, record, definitionHash);
    const request = buildJevRequest(machine, record, context);
    const data = raw as { model?: string; answers?: Record<string, { type?: string; choice?: string; confidence?: number; probabilities?: Record<string, number>; noul?: number }> };
    const answers = data?.answers;
    const unit = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1;
    const route = answers?.route;
    if (!route || route.type !== 'choice' || !route.choice || !Object.prototype.hasOwnProperty.call(request.questions.route.criteria!, route.choice) || !unit(route.confidence) || !route.probabilities || !unit(route.probabilities[route.choice])) throw new Error(tr("Jev 返回了无效路径或概率，当前位置未改变。"));
    const keys = Object.keys(request.questions.route.criteria!);
    if (keys.some(k => !unit(route.probabilities![k])) || Object.keys(route.probabilities).some(k => !keys.includes(k)) || Math.abs(Object.values(route.probabilities).reduce((a, b) => a + b, 0) - 1) > 0.02) throw new Error(tr("Jev 返回的概率分布不完整，当前位置未改变。"));
    const config = settings(machine);
    const checks: CheckResult[] = [];
    for (const [id, question] of Object.entries(request.questions)) {
      if (question.type !== 'noul') continue;
      const answer = answers![id];
      if (!answer || answer.type !== 'noul' || !unit(answer.noul)) throw new Error(tr("Jev 未返回完整的条件检查，当前位置未改变。"));
      checks.push({ id, label: question.instructions.split('\n').at(-1)!, probability: answer.noul, passed: answer.noul >= config.minProbability });
    }
    const selected = candidates(machine, record).find(c => c.id === route.choice);
    const passed = (key: string) => checks.find(c => c.id === key)?.passed === true;
    const confident = route.confidence >= config.minConfidence && route.probabilities[route.choice] >= config.minProbability;
    const decision: Decision = { transitionId: selected && confident ? selected.id : null, conditionMet: !!selected && passed(`condition:${selected.id}`), targetEntryMet: !!selected && (!entryCondition(machine, selected).trim() || passed(`entry:${selected.id}`)), passedQuality: selected?.requiredQuality.filter(id => passed(`quality:${id}`)) ?? [], evidence: tr("Jev {0}；选择 {1}；本次证据：{2}", { "0": data.model || request.model, "1": route.choice, "2": context.slice(0, 16000) }) };
    const result = applyDecision(machine, record, decision, definitionHash, 'jev');
    return { ...result, ...(!confident ? { reason: tr("Jev 概率或置信度低于设定阈值，保留当前状态。") } : {}), confidence: route.confidence, probability: route.probabilities[route.choice], probabilities: route.probabilities, checks };
  }
  return { settings, getState, path, initialRecord, assertRecord, listProgress, candidates, handoff, parseDecision, applyDecision, buildJevRequest, interpretJev };
}

export const runtime = createRuntime();
export function portableRuntimeSource(language: Language = 'zh') {
  // tsx can annotate nested functions with __name. It is only a naming helper;
  // keeping a local equivalent makes exports independent of the build tool.
  return `const __name = (fn, name) => fn;\n${portableTranslationSource(language)}\nconst runtime = (${createRuntime.toString()})(tr);\n`;
}

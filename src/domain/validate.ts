import { translator, type Language } from '../i18n/translate';
import { MachineSchema, type Diagnostic, type Machine } from './types';

export function validateMachine(machine: Machine, language: Language = 'zh'): Diagnostic[] {
  const tr = translator(language);
  const out: Diagnostic[] = [];
  const parsed = MachineSchema.safeParse(machine);
  if (!parsed.success) {
    parsed.error.issues.forEach(issue => out.push({ level: 'error', code: 'schema', message: `${issue.path.join('.')}：${tr(issue.message)}` }));
    return out;
  }
  const add = (level: Diagnostic['level'], code: string, message: string, stateId?: string, transitionId?: string) => out.push({ level, code, message, stateId, transitionId });
  if (!machine.name.trim()) add('error', 'name', tr("请填写状态机名称。"));
  if (!machine.version.trim()) add('error', 'version', tr("请填写版本。"));
  if (machine.id.length > 61) add('error', 'skill-name', tr("状态机标识最多 61 个字符，以保留技能名称的 df- 前缀。"));
  if (!machine.purpose.trim()) add('warning', 'purpose', tr("补充状态机用途，帮助 Agent 判断何时使用。"));
  if (!machine.states.length) add('error', 'empty', tr("添加至少一个状态后再导出。"));
  const states = new Map(machine.states.map(s => [s.id, s]));
  const predecessors = new Map<string, string[]>();
  for (const t of machine.transitions) {
    if (states.get(t.from)?.parentId !== states.get(t.to)?.parentId) continue;
    const from = predecessors.get(t.to) ?? []; from.push(t.from); predecessors.set(t.to, from);
  }
  const ids = new Set<string>();
  for (const state of machine.states) {
    if (ids.has(state.id)) add('error', 'duplicate-state', tr("状态 ID 重复：{0}", { "0": state.id }), state.id);
    ids.add(state.id);
    if (!state.name.trim()) add('error', 'state-name', tr("状态缺少名称。"), state.id);
    if (!state.description.trim()) add('warning', 'description', tr("「{0}」还没有状态说明。", { "0": state.name }), state.id);
    if (state.parentId && states.get(state.parentId)?.kind !== 'subflow') add('error', 'parent', tr("「{0}」的父状态机不存在。", { "0": state.name }), state.id);
    const ancestors = new Set([state.id]);
    let parent = state.parentId;
    while (parent) {
      if (ancestors.has(parent)) { add('error', 'parent-cycle', tr("「{0}」存在循环嵌套。", { "0": state.name }), state.id); break; }
      ancestors.add(parent); parent = states.get(parent)?.parentId ?? null;
    }
    const qualityIds = new Set<string>();
    for (const quality of state.qualityConditions) {
      if (qualityIds.has(quality.id)) add('error', 'duplicate-quality', tr("「{0}」的质量条件 ID 重复。", { "0": state.name }), state.id);
      qualityIds.add(quality.id);
      if (!quality.text.trim()) add('warning', 'quality-text', tr("「{0}」有尚未填写的质量条件。", { "0": state.name }), state.id);
      if (quality.required && state.kind !== 'list' && !machine.transitions.some(t => t.from === state.id && t.requiredQuality.includes(quality.id))) add('warning', 'unbound-quality', tr("「{0}」的质量条件「{1}」尚未关联到跳转。", { "0": state.name, "1": quality.text || quality.id }), state.id);
    }
    if (state.kind === 'list') {
      const items = state.list?.items ?? [];
      if (!items.length) add('error', 'list-empty', tr("为列表「{0}」添加至少一个事项。", { "0": state.name }), state.id);
      if (items.some(item => !item.text.trim())) add('error', 'list-item', tr("「{0}」的列表中有未填写的事项。", { "0": state.name }), state.id);
      if (new Set(items.map(item => item.id)).size !== items.length) add('error', 'list-duplicate', tr("「{0}」的列表事项 ID 重复。", { "0": state.name }), state.id);
      if (!state.list?.passCondition.trim()) add('error', 'list-condition', tr("为列表「{0}」填写统一通过条件。", { "0": state.name }), state.id);
    }
    if (state.kind === 'wait' && !state.strategies.during.trim() && !state.toolGuidance.trim()) add('warning', 'wait-policy', tr("为「{0}」补充等待或查询方式。", { "0": state.name }), state.id);
    if (state.kind === 'subflow') {
      const initial = states.get(state.initialState);
      if (!initial || initial.parentId !== state.id) add('error', 'subflow-entry', tr("为子状态机「{0}」选择一个内部入口。", { "0": state.name }), state.id);
    }
    if (state.kind === 'loop') {
      const routes = machine.transitions.filter(t => t.from === state.id);
      if (!routes.some(t => t.loopRole === 'continue')) add('warning', 'loop-continue', tr("为「{0}」添加继续循环的条件与目标。", { "0": state.name }), state.id);
      if (!routes.some(t => t.loopRole === 'exit')) add('warning', 'loop-exit', tr("为「{0}」添加退出循环的条件与目标。", { "0": state.name }), state.id);
      const canReturn = new Set<string>(); const pending = [state.id];
      while (pending.length) {
        const id = pending.pop()!;
        if (canReturn.has(id)) continue;
        canReturn.add(id);
        pending.push(...(predecessors.get(id) ?? []));
      }
      for (const route of routes.filter(t => t.loopRole === 'continue')) {
        if (!canReturn.has(route.to)) add('warning', 'loop-return', tr("「{0}」的继续路径尚未连回循环节点，请补充本轮完成后的返回路径。", { "0": state.name }), state.id, route.id);
      }
    }
  }
  const initial = states.get(machine.initialState);
  if (!initial || initial.parentId) add('error', 'initial', tr("请选择一个顶层状态作为入口。"));
  const transitionIds = new Set<string>();
  for (const t of machine.transitions) {
    if (transitionIds.has(t.id)) add('error', 'duplicate-transition', tr("跳转 ID 重复：{0}", { "0": t.id }), undefined, t.id);
    transitionIds.add(t.id);
    const from = states.get(t.from), to = states.get(t.to);
    if (!from || !to) { add('error', 'target', tr("跳转「{0}」引用了不存在的状态。", { "0": t.id }), undefined, t.id); continue; }
    if (from.kind === 'end') add('error', 'terminal-outgoing', tr("结束状态「{0}」不应有出边。", { "0": from.name }), from.id, t.id);
    if (from.parentId !== to.parentId) add('error', 'cross-scope', tr("跨层跳转应通过子状态机节点的入口与结束状态衔接。"), undefined, t.id);
    if (t.loopRole && from.kind !== 'loop') add('error', 'loop-role', tr("继续或退出循环的路径必须从循环节点出发。"), undefined, t.id);
    if (from.kind === 'loop' && !t.loopRole) add('warning', 'loop-role-missing', tr("为「{0}」的出路选择继续循环或退出循环。", { "0": from.name }), from.id, t.id);
    if (t.loopRole === 'exit' && t.from === t.to) add('error', 'loop-exit-self', tr("退出循环的目标应为其他状态。"), undefined, t.id);
    if (!t.condition.trim()) add('warning', 'condition', tr("「{0} → {1}」还没有跳转条件。", { "0": from.name, "1": to.name }), undefined, t.id);
    for (const id of t.requiredQuality) {
      if (!from.qualityConditions.some(q => q.id === id && q.required)) add('error', 'quality-reference', tr("跳转「{0}」引用了不存在或已改为建议的质量条件。", { "0": t.id }), undefined, t.id);
    }
  }
  const scopes = [null, ...machine.states.filter(s => s.kind === 'subflow').map(s => s.id)];
  for (const scope of scopes) {
    const members = machine.states.filter(s => s.parentId === scope);
    const entry = scope ? states.get(scope)?.initialState : machine.initialState;
    if (!members.some(s => s.kind === 'end')) add('warning', 'no-end', scope ? tr("子状态机「{0}」缺少结束状态。", { "0": states.get(scope)?.name }) : tr("状态机尚未定义结束状态。"), scope ?? undefined);
    const reachable = new Set<string>();
    const pending = entry ? [entry] : [];
    while (pending.length) {
      const id = pending.pop()!;
      if (reachable.has(id)) continue;
      reachable.add(id);
      machine.transitions.filter(t => t.from === id && states.get(t.to)?.parentId === scope).forEach(t => pending.push(t.to));
    }
    for (const state of members) {
      if (!reachable.has(state.id)) add('warning', 'unreachable', tr("「{0}」无法从当前层级的入口到达。", { "0": state.name }), state.id);
      if (state.kind !== 'end' && !machine.transitions.some(t => t.from === state.id)) add('warning', 'no-next', tr("「{0}」还没有下一步。", { "0": state.name }), state.id);
    }
  }
  return out;
}

import { useI18n } from '../i18n';
import { cloneElement, isValidElement, useEffect, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, ChevronRight, Copy, Flag, GitBranch, Plus, Settings2, Trash2, X } from 'lucide-react';
import { KIND_ICONS, type Selection } from '../editor/Canvas';
import { KIND_LABELS, LOOP_ROLE_LABELS, STATE_KINDS, isBranchState, newId, routingPolicyOf, type Machine, type Quality, type State, type Transition } from '../domain/types';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  const control = isValidElement<{ 'aria-label'?: string }>(children) && typeof children.type === 'string' && ['input', 'select', 'textarea'].includes(children.type)
    ? cloneElement(children, { 'aria-label': children.props['aria-label'] ?? label }) : children;
  return <label className="field"><span className="field-label">{label}</span>{control}{hint && <span className="field-hint">{hint}</span>}</label>;
}
export function TextField({ label, value, onChange, placeholder, rows = 3, hint, maxLength = 20000 }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; rows?: number; hint?: string; maxLength?: number }) {
  return <Field label={label} hint={hint}><textarea aria-label={label} rows={rows} maxLength={maxLength} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} /></Field>;
}
type Props = { machine: Machine; selection: Selection; updateMachine: (field: string, value: string) => void; updateState: (id: string, update: Partial<State>, key?: string) => void; updateTransition: (id: string, update: Partial<Transition>) => void; onSelect: (selection: Selection) => void; onDelete: () => void; onDuplicate: (id: string) => void; onParentChange: (id: string, parentId: string | null) => void; onAddTransition: (from: string, to?: string, loopRole?: Transition['loopRole'], stayOnState?: boolean) => void; onRemoveTransition: (id: string) => void };

function ListEditor({ state, update }: { state: State; update: (update: Partial<State>, key?: string) => void }) {
  const { t: tr } = useI18n();
  const list = state.list ?? { items: [], passCondition: '' };
  const move = (index: number, offset: number) => {
    const items = [...list.items];
    [items[index], items[index + offset]] = [items[index + offset], items[index]];
    update({ list: { ...list, items } });
  };
  return <section className="state-list-editor">
    <div className="section-label"><h3>{tr("按序事项")} <span>{list.items.length}</span></h3><button className="text-button" disabled={list.items.length >= 100} onClick={() => update({ list: { ...list, items: [...list.items, { id: newId('item'), text: '' }] } })}><Plus size={14} />{tr("添加事项")}</button></div>
    <p className="panel-hint">{tr("按顺序逐项执行，每项使用同一通过条件。全部通过后才能检查出口。")}</p>
    {list.items.map((item, index) => <div className="list-item-editor" key={item.id}>
      <div className="list-item-heading"><strong>{index + 1}</strong><button className="icon-button" disabled={index === 0} aria-label={tr("上移事项 {0}", { "0": index + 1 })} onClick={() => move(index, -1)}><ArrowUp size={13} /></button><button className="icon-button" disabled={index === list.items.length - 1} aria-label={tr("下移事项 {0}", { "0": index + 1 })} onClick={() => move(index, 1)}><ArrowDown size={13} /></button><button className="icon-button" aria-label={tr("删除事项 {0}", { "0": index + 1 })} onClick={() => update({ list: { ...list, items: list.items.filter(entry => entry.id !== item.id) } })}><X size={13} /></button></div>
      <textarea aria-label={tr("事项 {0}", { "0": index + 1 })} rows={2} maxLength={4000} value={item.text} placeholder={tr("这一项要完成什么？")} onChange={event => update({ list: { ...list, items: list.items.map(entry => entry.id === item.id ? { ...entry, text: event.target.value } : entry) } }, `list-${item.id}`)} />
    </div>)}
    {!list.items.length && <div className="small-empty">{tr("添加需要逐一处理的事项。")}</div>}
    <TextField label={tr("统一通过条件")} rows={3} maxLength={4000} value={list.passCondition} onChange={passCondition => update({ list: { ...list, passCondition } }, 'list-condition')} placeholder={tr("例如：本项结果已验证，必要检查全部通过。")} hint={tr("每项独立检查，不沿用上一项的通过结果。失败或不确定时停留在当前项。")}/>
  </section>;
}

function BranchRoutes({ state, ...props }: Props & { state: State }) {
  const { t: tr } = useI18n();
  const peers = props.machine.states.filter(s => s.parentId === state.parentId);
  const incoming = props.machine.transitions.filter(t => t.to === state.id);
  const outgoing = props.machine.transitions.filter(t => t.from === state.id);
  const sources = peers.filter(s => s.kind !== 'end');
  return <div className="branch-routes">
    <div className="section-label"><h3>{tr("进入路径 ")}<span className="route-count">{incoming.length}</span></h3><button className="text-button" disabled={!sources.length} onClick={() => props.onAddTransition((sources.find(s => s.id !== state.id) ?? sources[0]).id, state.id, undefined, true)}><Plus size={14} />{tr("添加入路")}</button></div>
    <p className="panel-hint">{tr("可由不同状态进入，每条入路分别定义来源与条件。")}</p>
    {incoming.map((t, index) => <div className="route-editor incoming" key={t.id} data-testid={`route-editor-${t.id}`}>
      <div className="route-editor-heading"><span>{tr("入路 ")}{index + 1}</span><button className="icon-button" aria-label={tr("删除入路 {0}", { "0": index + 1 })} onClick={() => props.onRemoveTransition(t.id)}><X size={13} /></button></div>
      <Field label={tr("入路 {0} 来源", { "0": index + 1 })}><select value={t.from} onChange={e => props.updateTransition(t.id, { from: e.target.value, requiredQuality: [] })}>{sources.map(s => <option key={s.id} value={s.id}>{s.name || s.id}</option>)}</select></Field>
      <TextField label={tr("入路 {0} 条件", { "0": index + 1 })} rows={2} maxLength={4000} value={t.condition} onChange={condition => props.updateTransition(t.id, { condition })} placeholder={tr("什么条件满足后，可以进入此节点？")} />
      <button className="text-button route-details" onClick={() => props.onSelect({ type: 'transition', id: t.id })}>{tr("质量与更多设置")}<ChevronRight size={12} /></button>
    </div>)}
    {!incoming.length && <div className="small-empty">{tr("当前没有入路；入口节点也可以直接开始。")}</div>}
    <div className="section-label separated"><h3>{tr("条件出路 ")}<span className="route-count">{outgoing.length}</span></h3>{state.kind !== 'loop' && <button className="text-button" onClick={() => props.onAddTransition(state.id, undefined, undefined, true)}><Plus size={14} />{tr("添加出路")}</button>}</div>
    <p className="panel-hint">{tr("每条出路绑定一个条件与目标，条件满足后进入对应路径。")}</p>
    {state.kind === 'loop' && <><div className="loop-route-actions"><button className="button small" onClick={() => props.onAddTransition(state.id, undefined, 'continue', true)}><Plus size={13} />{tr("继续循环")}</button><button className="button small" onClick={() => props.onAddTransition(state.id, undefined, 'exit', true)}><Plus size={13} />{tr("退出循环")}</button></div><p className="panel-hint">{tr("本轮目标完成后连回此循环节点，重新判断继续或退出。")}</p></>}
    {outgoing.map((t, index) => <div className={`route-editor outgoing ${t.loopRole ?? ''}`} key={t.id} data-testid={`route-editor-${t.id}`}>
      <div className="route-editor-heading"><span>{tr("出路 ")}{index + 1}{t.loopRole ? ` · ${tr(LOOP_ROLE_LABELS[t.loopRole])}` : ''}</span><button className="icon-button" aria-label={tr("删除出路 {0}", { "0": index + 1 })} onClick={() => props.onRemoveTransition(t.id)}><X size={13} /></button></div>
      {state.kind === 'loop' && <Field label={tr("出路 {0} 循环行为", { "0": index + 1 })}><select value={t.loopRole ?? ''} onChange={e => props.updateTransition(t.id, { loopRole: e.target.value as Transition['loopRole'] })}><option value="" disabled>{tr("选择循环行为")}</option><option value="continue">{tr("继续循环")}</option><option value="exit">{tr("退出循环")}</option></select></Field>}
      <TextField label={tr("出路 {0} 条件", { "0": index + 1 })} rows={3} maxLength={4000} value={t.condition} onChange={condition => props.updateTransition(t.id, { condition })} placeholder={t.loopRole === 'exit' ? tr("什么条件满足时退出循环？") : t.loopRole === 'continue' ? tr("什么条件满足时继续下一轮？") : tr("什么条件满足时进入这条路径？")} />
      <Field label={tr("出路 {0} 目标", { "0": index + 1 })}><select value={t.to} onChange={e => props.updateTransition(t.id, { to: e.target.value })}>{peers.map(s => <option key={s.id} value={s.id}>{s.name || s.id}{s.id === state.id ? tr("（回到自身）") : ''}</option>)}</select></Field>
      <button className="text-button route-details" onClick={() => props.onSelect({ type: 'transition', id: t.id })}>{tr("质量与更多设置")}{t.requiredQuality.length > 0 && <span>· {t.requiredQuality.length} {tr(" 项质量检查")}</span>}<ChevronRight size={12} /></button>
    </div>)}
    {!outgoing.length && <div className="small-empty">{tr("添加条件出路，指定满足条件后去往哪个状态。")}</div>}
    <TextField label={tr("分支选择策略")} rows={5} value={state.routingPolicy ?? tr(routingPolicyOf(state))} onChange={routingPolicy => props.updateState(state.id, { routingPolicy }, 'routing-policy')} hint={tr("说明多项同时满足、没有匹配或证据不足时，Agent 应如何选择或停留。")} />
  </div>;
}
export function Inspector(props: Props) {
  const { t: tr } = useI18n();
  const { machine, selection } = props;
  const state = selection?.type === 'state' ? machine.states.find(s => s.id === selection.id) : undefined;
  const transition = selection?.type === 'transition' ? machine.transitions.find(t => t.id === selection.id) : undefined;
  const [tab, setTab] = useState('overview');
  useEffect(() => setTab(state && isBranchState(state) ? 'conditions' : 'overview'), [selection?.id, state?.kind]);
  const updateState = (update: Partial<State>, key?: string) => state && props.updateState(state.id, update, key);
  const updateQuality = (id: string, update: Partial<Quality>) => state && updateState({ qualityConditions: state.qualityConditions.map(q => q.id === id ? { ...q, ...update } : q) }, `quality-${id}`);
  const validParents = machine.states.filter(s => {
    if (!state || s.id === state.id || s.kind !== 'subflow') return false;
    let p: string | null = s.parentId; const seen = new Set<string>();
    while (p && !seen.has(p)) { if (p === state.id) return false; seen.add(p); p = machine.states.find(n => n.id === p)?.parentId ?? null; }
    return true;
  });
  return <aside className="inspector" aria-label={tr("属性面板")}>
    <div className="inspector-heading"><span className="eyebrow">{state ? tr('状态属性') : transition ? tr('跳转属性') : tr('状态机配置')}</span><button className="icon-button" title={tr("状态机设置")} aria-label={tr("状态机设置")} onClick={() => props.onSelect(null)}><Settings2 size={16} /></button></div>
    {state ? <>
      <div className="inspector-title"><span className={`inspector-kind kind-${state.kind}`}>{(() => { const Icon = KIND_ICONS[state.kind]; return <Icon size={20} />; })()}</span><div><h2>{state.name || tr("未命名状态")}</h2><code>{state.id}</code></div></div>
      <div className="inspector-tabs"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>{tr("状态说明")}</button><button className={tab === 'conditions' ? 'active' : ''} onClick={() => setTab('conditions')}>{tr("条件与跳转")}</button><button className={tab === 'tools' ? 'active' : ''} onClick={() => setTab('tools')}>{tr("工具与策略")}</button></div>
      <div className="inspector-body">
        {tab === 'overview' && <>
          <Field label={tr("状态名称")}><input value={state.name} maxLength={120} onChange={e => updateState({ name: e.target.value }, 'name')} /></Field>
          <Field label={tr("状态类型")}><select value={state.kind} onChange={e => updateState({ kind: e.target.value as State['kind'] })}>{STATE_KINDS.map(kind => <option key={kind} value={kind}>{tr(KIND_LABELS[kind])}</option>)}</select></Field>
          <TextField label={tr("状态说明")} value={state.description} onChange={description => updateState({ description }, 'description')} placeholder={tr("这个状态意味着什么？Agent 应在这里完成什么？")} rows={5} />
          {state.kind === 'list' && <ListEditor state={state} update={updateState} />}
          <TextField label={tr("进入条件")} value={state.entryConditions} onChange={entryConditions => updateState({ entryConditions }, 'entry')} placeholder={tr("什么情况下进入当前状态？")} />
          {validParents.length > 0 || state.parentId ? <Field label={tr("所属状态机")}><select value={state.parentId ?? ''} onChange={e => props.onParentChange(state.id, e.target.value || null)}><option value="">{tr("顶层状态机")}</option>{validParents.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field> : null}
          {state.kind === 'subflow' && <Field label={tr("内部入口")} hint={tr("先添加工作状态，再将其所属状态机设为当前节点。")}><select value={state.initialState} onChange={e => updateState({ initialState: e.target.value })}><option value="">{tr("选择内部入口")}</option>{machine.states.filter(s => s.parentId === state.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>}
          {state.kind === 'end' && <Field label={tr("结束结果")}><select value={state.outcome} onChange={e => updateState({ outcome: e.target.value as State['outcome'] })}><option value="success">{tr("完成")}</option><option value="failure">{tr("失败")}</option><option value="stopped">{tr("主动停止")}</option></select></Field>}
          <div className="note-box"><span><Flag size={15} /></span><p>{tr("节点记录工作方法与判断依据。具体怎么做，由你的 Agent 决定。")}</p></div>
        </>}
        {tab === 'conditions' && <>
          {isBranchState(state) && <BranchRoutes {...props} state={state} />}
          <div className="section-label"><h3>{tr("质量条件")}</h3><button className="text-button" disabled={state.qualityConditions.length >= 50} onClick={() => updateState({ qualityConditions: [...state.qualityConditions, { id: newId('quality'), text: '', required: true }] })}><Plus size={14} />{tr("添加")}</button></div>
          <p className="panel-hint">{state.kind === 'list' ? tr("这里的必要质量项会对每个事项重复检查；出口仍按各自关联的质量项判断。") : tr("将检查项关联到具体跳转；改进建议用于提升结果质量。")}</p>
          {state.qualityConditions.map((q, index) => <div className="quality-card" key={q.id}><div className="quality-heading"><span>{tr("检查项 ")}{index + 1}</span><select aria-label={tr("质量条件 {0} 类型", { "0": index + 1 })} value={q.required ? 'required' : 'suggested'} onChange={e => updateQuality(q.id, { required: e.target.value === 'required' })}><option value="required">{tr("跳转检查项")}</option><option value="suggested">{tr("改进建议")}</option></select><button className="icon-button" aria-label={tr("删除质量条件 {0}", { "0": index + 1 })} onClick={() => updateState({ qualityConditions: state.qualityConditions.filter(item => item.id !== q.id) })}><X size={13} /></button></div><textarea aria-label={tr("质量条件 {0}", { "0": index + 1 })} rows={3} maxLength={2000} value={q.text} placeholder={tr("怎样的结果才算达到要求？")} onChange={e => updateQuality(q.id, { text: e.target.value })} /></div>)}
          {!state.qualityConditions.length && <div className="small-empty">{tr("添加一个可检查的结果要求。")}</div>}
          {!isBranchState(state) && <><div className="section-label separated"><h3>{tr("下个步骤")}</h3>{state.kind !== 'end' && <button className="text-button" onClick={() => props.onAddTransition(state.id)}><Plus size={14} />{tr("添加")}</button>}</div>
          {machine.transitions.filter(t => t.from === state.id).map(t => <button key={t.id} className="next-step" onClick={() => props.onSelect({ type: 'transition', id: t.id })}><span className="next-icon"><ArrowRight size={15} /></span><span><strong>{machine.states.find(s => s.id === t.to)?.name ?? t.to}</strong><small>{t.condition || tr("还没有填写跳转条件")}</small></span><ChevronRight size={14} /></button>)}
          {!machine.transitions.some(t => t.from === state.id) && <div className="small-empty">{state.kind === 'end' ? tr("这是结束状态，无需下一步。") : tr("连接画布上的状态，或在这里添加跳转。")}</div>}</>}
        </>}
        {tab === 'tools' && <>
          <TextField label={tr("工具调用说明")} rows={4} value={state.toolGuidance} onChange={toolGuidance => updateState({ toolGuidance }, 'tool')} placeholder={tr("需要什么能力、什么时候调用、如何关联结果…")} />
          <TextField label={tr("配置说明")} value={state.configuration} onChange={configuration => updateState({ configuration }, 'config')} placeholder={tr("参数建议、任务类型、查询间隔…")} />
          <TextField label={tr("当前状态的策略")} rows={4} value={state.strategies.during} onChange={during => updateState({ strategies: { ...state.strategies, during } }, 'during')} placeholder={tr("等待期间做什么，如何推进任务？")} />
          <TextField label={tr("失败时")} value={state.strategies.onFailure} onChange={onFailure => updateState({ strategies: { ...state.strategies, onFailure } }, 'failure')} placeholder={tr("遇到明确失败时，如何处理？")} />
          <TextField label={tr("无法判断时")} value={state.strategies.onUncertain} onChange={onUncertain => updateState({ strategies: { ...state.strategies, onUncertain } }, 'uncertain')} />
          <div className="note-box"><p>{tr("这些内容会随 Skill 导出，工具调用与等待由宿主 Agent 处理。")}</p></div>
        </>}
      </div>
      <div className="inspector-footer"><button className="button small" onClick={() => state.parentId ? props.updateState(state.parentId, { initialState: state.id }) : props.updateMachine('initialState', state.id)}><Flag size={14} />{machine.initialState === state.id || machine.states.some(s => s.initialState === state.id) ? tr("当前入口") : tr("设为入口")}</button><button className="icon-button" title={tr("复制状态")} aria-label={tr("复制状态")} onClick={() => props.onDuplicate(state.id)}><Copy size={16} /></button><button className="icon-button danger" title={tr("删除状态")} aria-label={tr("删除状态")} onClick={props.onDelete}><Trash2 size={16} /></button></div>
    </> : transition ? <>
      <div className="inspector-title"><span className="inspector-kind"><GitBranch size={20} /></span><div><h2>{tr("状态跳转")}</h2><code>{transition.id}</code></div></div>
      <div className="inspector-body">
        <Field label={tr("来源状态")}><select value={transition.from} onChange={e => props.updateTransition(transition.id, { from: e.target.value, requiredQuality: [] })}>{machine.states.filter(s => s.kind !== 'end').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field label={tr("目标状态")}><select value={transition.to} onChange={e => props.updateTransition(transition.id, { to: e.target.value })}>{machine.states.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <TextField label={tr("跳转条件")} rows={5} maxLength={4000} value={transition.condition} onChange={condition => props.updateTransition(transition.id, { condition })} placeholder={tr("什么事实或事件成立时，可以进行这次跳转？")} />
        <Field label={tr("路径类型")}><select value={transition.kind} onChange={e => props.updateTransition(transition.id, { kind: e.target.value as Transition['kind'] })}><option value="normal">{tr("正常路径")}</option><option value="fallback">{tr("返工 / 异常路径")}</option></select></Field>
        {machine.states.find(s => s.id === transition.from)?.kind === 'loop' && <Field label={tr("循环行为")}><select value={transition.loopRole ?? ''} onChange={e => props.updateTransition(transition.id, { loopRole: e.target.value as Transition['loopRole'] })}><option value="" disabled>{tr("选择循环行为")}</option><option value="continue">{tr("继续循环")}</option><option value="exit">{tr("退出循环")}</option></select></Field>}
        <div className="section-label separated"><h3>{tr("必要质量项")}</h3></div><p className="panel-hint">{tr("勾选来源状态中与本次跳转有关的检查项。")}</p>
        {machine.states.find(s => s.id === transition.from)?.qualityConditions.filter(q => q.required).map(q => <label className="check-row" key={q.id}><input type="checkbox" checked={transition.requiredQuality.includes(q.id)} onChange={e => props.updateTransition(transition.id, { requiredQuality: e.target.checked ? [...transition.requiredQuality, q.id] : transition.requiredQuality.filter(id => id !== q.id) })} /><span>{q.text || tr("未命名检查项")}</span></label>)}
        {!machine.states.find(s => s.id === transition.from)?.qualityConditions.some(q => q.required) && <div className="small-empty">{tr("来源状态还没有可关联的质量项。")}</div>}
        <TextField label={tr("条件不确定时")} maxLength={2000} value={transition.onUncertain} onChange={onUncertain => props.updateTransition(transition.id, { onUncertain })} />
      </div>
      <div className="inspector-footer"><button className="button small danger" onClick={props.onDelete}><Trash2 size={14} />{tr("删除跳转")}</button></div>
    </> : <>
      <div className="inspector-title"><span className="inspector-kind"><Settings2 size={20} /></span><div><h2>{tr("状态机设置")}</h2><small>{tr("定义这份工作方法的用途")}</small></div></div>
      <div className="inspector-body">
        <Field label={tr("状态机名称")}><input value={machine.name} maxLength={120} onChange={e => props.updateMachine('name', e.target.value)} /></Field>
        <Field label={tr("唯一标识")} hint={tr("小写字母、数字和短横线，用于 Skill 名称。")}><input value={machine.id} maxLength={61} onChange={e => props.updateMachine('id', e.target.value)} spellCheck={false} /></Field>
        <Field label={tr("版本")}><input value={machine.version} maxLength={40} onChange={e => props.updateMachine('version', e.target.value)} /></Field>
        <TextField label={tr("用途与目标")} value={machine.purpose} rows={5} onChange={purpose => props.updateMachine('purpose', purpose)} placeholder={tr("这份状态机适合什么任务，希望解决什么问题？")} />
        <Field label={tr("初始状态")}><select value={machine.initialState} onChange={e => props.updateMachine('initialState', e.target.value)}><option value="">{tr("选择入口状态")}</option>{machine.states.filter(s => !s.parentId).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <div className="note-box"><p>{tr("设计保存在当前浏览器。导出项目 JSON 可用于备份、分享与迁移。")}</p></div>
      </div>
    </>}
  </aside>;
}

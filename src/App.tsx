import { useI18n } from './i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCircle2, ChevronDown, Code2, Copy, Download, FileJson, FileText, Flag, FolderOpen, GitBranch, HelpCircle, Layers, LayoutGrid, Loader2, MoreHorizontal, Package, PanelRight, Plus, Redo2, Save, Search, Settings2, ShieldCheck, Sparkles, Trash2, Undo2, Upload, Workflow, X } from 'lucide-react';
import type { Connection } from '@xyflow/react';
import { Canvas, KIND_ICONS, positionOf, stateCardSize, type Selection } from './editor/Canvas';
import { useWorkspace } from './editor/useWorkspace';
import { connectionPorts } from './editor/connections';
import { Inspector } from './components/Inspector';
import { Modal } from './components/Modal';
import { ExportDialog, FilePreview } from './components/ExportDialog';
import { LanguageSelector } from './components/LanguageSelector';
import { RuntimePanel } from './components/RuntimePanel';
import { MarkdownDocument } from './components/MermaidDiagram';
import { TEMPLATES, type TemplateId } from './domain/templates';
import { KIND_LABELS, STATE_KINDS, clone, importProject, newId, newState, type Machine, type Project, type State, type StateKind, type Transition } from './domain/types';
import { validateMachine } from './domain/validate';
import { buildSkillBundle, compileMarkdown, compileXml, type Bundle } from './domain/compiler';
import { copyText, downloadFile, type LocalInfo } from './lib/files';

type View = 'canvas' | 'description' | 'skill' | 'runtime';
type ModalType = 'templates' | 'export' | 'diagnostics' | 'help' | 'delete-document' | null;

export default function App() {
  const { t: tr, language, system } = useI18n();
  const workspace = useWorkspace(language);
  const { project } = workspace;
  const machineKey = JSON.stringify(project.machine);
  // Layout edits do not recompile the semantic definition or Skill package.
  const machine = useMemo(() => project.machine, [machineKey]);
  const [selection, setSelection] = useState<Selection>({ type: 'state', id: 'waiting' });
  const [view, setView] = useState<View>('canvas');
  const [modal, setModal] = useState<ModalType>(null);
  const [search, setSearch] = useState('');
  const [inspectorOpen, setInspectorOpen] = useState(window.innerWidth >= 1050);
  const [descriptionMode, setDescriptionMode] = useState<'read' | 'source' | 'xml'>('read');
  const [activeFile, setActiveFile] = useState('SKILL.md');
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [bundleError, setBundleError] = useState('');
  const bundleMachine = useRef(machine);
  const [localInfo, setLocalInfo] = useState<LocalInfo | null>(null);
  const [toast, setToast] = useState<{ message: string; error: boolean } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);
  const closeModal = useCallback(() => setModal(null), []);
  const notify = useCallback((message: string, error = false) => { clearTimeout(toastTimer.current); setToast({ message, error }); toastTimer.current = setTimeout(() => setToast(null), error ? 6500 : 3500); }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/info', { signal: controller.signal }).then(r => r.ok ? r.json() : null).then(value => { if (value?.token) setLocalInfo(value); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => { if (workspace.recovery) notify(tr("原浏览器记录格式异常，已尝试保留恢复副本。可重新导入项目 JSON。"), true); }, [workspace.recovery, notify]);
  const diagnostics = useMemo(() => validateMachine(machine, language), [machine, language]);
  const errors = diagnostics.filter(d => d.level === 'error');
  const warnings = diagnostics.filter(d => d.level === 'warning');
  const descriptions = useMemo(() => { try { return { markdown: compileMarkdown(machine, language), xml: compileXml(machine, language) }; } catch { return { markdown: tr("# 请先修正定义格式\n\n检查右侧状态机标识和必填内容。"), xml: tr("请先修正定义格式。") }; } }, [machine, language]);
  useEffect(() => {
    let active = true; setBundleError('');
    if (bundleMachine.current !== machine) { setBundle(null); bundleMachine.current = machine; }
    if (errors.length) { setBundle(null); setBundleError(tr("修正结构问题后，即可生成完整 Skill。")); return; }
    void buildSkillBundle(machine, language).then(result => { if (active) setBundle(result); }).catch(error => { if (active) setBundleError(error.message); });
    return () => { active = false; };
  }, [machine, language]);
  const select = (value: Selection) => { setSelection(value); if (value) setInspectorOpen(true); };
  const switchDocument = (key: string) => { workspace.switchTo(key); setSelection(null); setSearch(''); setView('canvas'); };
  const create = (id: TemplateId) => { if (workspace.documents.length >= 100) { notify(tr("工作空间最多保存 100 份状态机，请先导出并移除不再使用的项目。"), true); return; } workspace.create(id); setSelection(null); setView('canvas'); setModal(null); setSearch(''); notify(tr("新的状态机已创建。")); };
  const addState = (kind: StateKind, position?: { x: number; y: number }) => {
    if (machine.states.length >= 250) { notify(tr("当前版本最多支持 250 个状态。"), true); return; }
    const state = newState(kind, undefined, tr(KIND_LABELS[kind]));
    state.strategies.onUncertain = tr(state.strategies.onUncertain);
    workspace.edit(d => { d.machine.states.push(state); d.layout[state.id] = position ?? { x: 60 + d.machine.states.length % 3 * 340, y: 90 + Math.floor(d.machine.states.length / 3) * 240 }; if (!d.machine.initialState) d.machine.initialState = state.id; });
    select({ type: 'state', id: state.id }); setView('canvas');
  };
  const updateState = (id: string, update: Partial<State>, key?: string) => workspace.edit(d => {
    const state = d.machine.states.find(s => s.id === id); if (!state) return;
    Object.assign(state, update);
    if (state.kind === 'list' && !state.list) state.list = { items: [], passCondition: '' };
    const valid = new Set(state.qualityConditions.filter(q => q.required).map(q => q.id));
    d.machine.transitions.filter(t => t.from === id).forEach(t => {
      t.requiredQuality = t.requiredQuality.filter(q => valid.has(q));
      if (state.kind !== 'loop') delete t.loopRole;
      else if (!t.loopRole) t.loopRole = 'continue';
    });
  }, key ? `state-${id}-${key}` : undefined);
  const updateMachine = (field: string, value: string) => workspace.edit(d => { (d.machine as unknown as Record<string, unknown>)[field] = value; }, `machine-${field}`);
  const updateTransition = (id: string, update: Partial<Transition>, ports?: NonNullable<Project['connections']>[string]) => workspace.edit(d => {
    const t = d.machine.transitions.find(t => t.id === id); if (!t) return;
    if (d.connections && ((update.from && update.from !== t.from) || (update.to && update.to !== t.to))) delete d.connections[id];
    Object.assign(t, update);
    if (ports) (d.connections ??= {})[id] = ports;
    const source = d.machine.states.find(s => s.id === t.from);
    t.requiredQuality = t.requiredQuality.filter(id => source?.qualityConditions.some(q => q.id === id && q.required));
    if (source?.kind !== 'loop') delete t.loopRole;
    else if (!t.loopRole) t.loopRole = 'continue';
  }, `transition-${id}-${Object.keys(update).join('-')}`);
  const connect = (connection: Connection, options?: { loopRole?: Transition['loopRole']; stayOnState?: boolean }) => {
    const from = machine.states.find(s => s.id === connection.source), to = machine.states.find(s => s.id === connection.target);
    if (!from || !to || from.kind === 'end') return;
    if (from.parentId !== to.parentId) { notify(tr("请通过子状态机节点的对外连线连接不同层级。"), true); return; }
    const existing = connection.sourceHandle?.startsWith('route-out-') ? machine.transitions.find(t => t.id === connection.sourceHandle!.slice('route-out-'.length) && t.from === from.id) : undefined;
    const ports = { sourceHandle: connection.sourceHandle === 'out-bottom' ? 'out-bottom' as const : 'out' as const, targetHandle: connection.targetHandle === 'in-top' ? 'in-top' as const : 'in' as const };
    if (existing) { updateTransition(existing.id, { to: to.id }, ports); select({ type: 'transition', id: existing.id }); return; }
    if (machine.transitions.length >= 1000) { notify(tr("当前版本最多支持 1,000 条跳转。"), true); return; }
    const id = newId('transition');
    workspace.edit(d => { d.machine.transitions.push({ id, from: from.id, to: to.id, condition: '', requiredQuality: [], onUncertain: tr("保留当前状态，补充信息后再次检查。"), kind: 'normal', ...(from.kind === 'loop' ? { loopRole: options?.loopRole ?? (to.kind === 'end' ? 'exit' : 'continue') } : {}) }); (d.connections ??= {})[id] = ports; });
    if (!options?.stayOnState) select({ type: 'transition', id });
  };
  const addTransition = (from: string, to?: string, loopRole?: Transition['loopRole'], stayOnState = false) => {
    const source = machine.states.find(s => s.id === from);
    const peers = machine.states.filter(s => s.id !== from && s.parentId === source?.parentId);
    const target = to ? machine.states.find(s => s.id === to) : loopRole === 'exit' ? peers.find(s => s.kind === 'end') ?? peers[0] : loopRole === 'continue' ? peers.find(s => s.kind !== 'end') ?? source : peers[0] ?? source;
    if (!target) { notify(tr("先在同一层级添加目标状态。")); return; }
    connect({ source: from, target: target.id, sourceHandle: 'out', targetHandle: 'in' }, { loopRole, stayOnState });
  };
  const removeSelection = () => {
    if (!selection) return;
    workspace.edit(d => {
      if (selection.type === 'transition') { d.machine.transitions = d.machine.transitions.filter(t => t.id !== selection.id); return; }
      const remove = new Set([selection.id]);
      for (let i = 0; i < d.machine.states.length; i++) for (const s of d.machine.states) if (s.parentId && remove.has(s.parentId)) remove.add(s.id);
      d.machine.states = d.machine.states.filter(s => !remove.has(s.id));
      d.machine.transitions = d.machine.transitions.filter(t => !remove.has(t.from) && !remove.has(t.to));
      remove.forEach(id => delete d.layout[id]);
      if (d.machine.planning) {
        remove.forEach(id => delete d.machine.planning!.tasks[id]);
        for (const task of Object.values(d.machine.planning.tasks)) if (task.dependsOn) task.dependsOn = task.dependsOn.filter(id => !remove.has(id));
      }
      if (remove.has(d.machine.initialState)) d.machine.initialState = d.machine.states.find(s => !s.parentId)?.id ?? '';
      for (const state of d.machine.states) if (remove.has(state.initialState)) state.initialState = d.machine.states.find(s => s.parentId === state.id)?.id ?? '';
    });
    setSelection(null); notify(tr("已删除，可使用撤销恢复。"));
  };
  const duplicate = (id: string) => {
    const source = machine.states.find(s => s.id === id); if (!source) return;
    const include = new Set([id]);
    for (let i = 0; i < machine.states.length; i++) for (const s of machine.states) if (s.parentId && include.has(s.parentId)) include.add(s.id);
    if (machine.states.length + include.size > 250) { notify(tr("复制后会超出 250 个状态的上限。"), true); return; }
    if (machine.transitions.length + machine.transitions.filter(t => include.has(t.from) && include.has(t.to)).length > 1000) { notify(tr("复制后会超出 1,000 条跳转的上限。"), true); return; }
    const mapping = new Map([...include].map(key => [key, newId()]));
    workspace.edit(d => {
      for (const state of machine.states.filter(s => include.has(s.id))) {
        const copy = clone(state); copy.id = mapping.get(state.id)!;
        if (state.id === id) copy.name = tr("{0} 副本", { "0": state.name.slice(0, 110) });
        if (copy.parentId && mapping.has(copy.parentId)) copy.parentId = mapping.get(copy.parentId)!;
        if (copy.initialState && mapping.has(copy.initialState)) copy.initialState = mapping.get(copy.initialState)!;
        d.machine.states.push(copy);
        if (d.machine.planning?.tasks[state.id]) {
          const task = clone(d.machine.planning.tasks[state.id]);
          if (task.dependsOn) task.dependsOn = task.dependsOn.map(id => mapping.get(id) ?? id);
          d.machine.planning.tasks[copy.id] = task;
        }
        const p = positionOf(project, state.id); d.layout[copy.id] = { ...p, x: p.x + (state.id === id ? 45 : 0), y: p.y + (state.id === id ? 45 : 0) };
      }
      for (const t of machine.transitions.filter(t => include.has(t.from) && include.has(t.to))) {
        const copyId = newId('transition');
        d.machine.transitions.push({ ...clone(t), id: copyId, from: mapping.get(t.from)!, to: mapping.get(t.to)! });
        (d.connections ??= {})[copyId] = { ...connectionPorts(project, t) };
      }
    });
    select({ type: 'state', id: mapping.get(id)! }); notify(tr("状态已复制。"));
  };
  const changeParent = (id: string, parentId: string | null) => workspace.edit(d => {
    const state = d.machine.states.find(s => s.id === id); if (!state) return;
    const previous = state.parentId; state.parentId = parentId;
    d.layout[id] = parentId ? { x: 32 + d.machine.states.filter(s => s.parentId === parentId).length % 2 * 300, y: 120 } : { x: 80, y: 150 };
    if (previous) { const old = d.machine.states.find(s => s.id === previous); if (old?.initialState === id) old.initialState = d.machine.states.find(s => s.parentId === previous)?.id ?? ''; }
    if (parentId) { const parent = d.machine.states.find(s => s.id === parentId); if (parent && !parent.initialState) parent.initialState = id; }
    if (d.machine.initialState === id && parentId) d.machine.initialState = d.machine.states.find(s => !s.parentId)?.id ?? '';
  });
  const arrange = () => {
    workspace.edit(d => {
      for (const scope of [null, ...d.machine.states.filter(s => s.kind === 'subflow').map(s => s.id)]) {
        const members = d.machine.states.filter(s => s.parentId === scope);
        if (scope) { let y = 112; members.forEach(s => { d.layout[s.id] = { ...positionOf(d, s.id), x: 28, y }; y += stateCardSize(s, d.machine).height + 55; }); continue; }
        const depth = new Map<string, number>(); const entry = d.machine.initialState; const queue = entry ? [entry] : [];
        if (entry) depth.set(entry, 0);
        while (queue.length) { const current = queue.shift()!; for (const t of d.machine.transitions.filter(t => t.from === current)) if (!depth.has(t.to)) { depth.set(t.to, (depth.get(current) ?? 0) + 1); queue.push(t.to); } }
        const rows = new Map<number, number>();
        members.forEach((state, i) => { const column = depth.get(state.id) ?? i % 3; const y = rows.get(column) ?? 80; rows.set(column, y + stateCardSize(state, d.machine).height + 90); d.layout[state.id] = { ...positionOf(d, state.id), x: 40 + column * 410, y }; });
      }
    }); notify(tr("已按状态关系整理布局。点击适应画布可查看全图。"));
  };
  const exportProject = () => { downloadFile(JSON.stringify(project, null, 2) + '\n', `${machine.id || 'machine'}.decoupleflow.json`, 'application/json'); notify(tr("项目文件已导出，包含画布布局。")); };
  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error(tr("项目文件超过 2 MB 上限。"));
      if (workspace.documents.length >= 100) throw new Error(tr("请先移除不再使用的状态机。"));
      const imported = importProject(JSON.parse(await file.text()));
      const fatal = validateMachine(imported.machine).find(d => ['duplicate-state', 'parent-cycle'].includes(d.code));
      if (fatal) throw new Error(fatal.message);
      workspace.add(imported); setView('canvas'); setSelection(null); setSearch(''); notify(tr("已导入为独立状态机，原有内容保留。"));
    } catch (error) { notify(tr("导入失败：{0}", { "0": (error as Error).message }), true); }
    finally { if (fileInput.current) fileInput.current.value = ''; }
  };
  const openExport = () => { if (errors.length) { setModal('diagnostics'); return; } if (!bundle) { notify(bundleError || tr("正在生成 Skill，请稍后重试。"), !!bundleError); return; } setModal('export'); };
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); exportProject(); return; }
      if ((event.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? workspace.redo() : workspace.undo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); workspace.redo(); }
      else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selection?.type === 'state') { event.preventDefault(); duplicate(selection.id); }
      else if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeSelection(); }
      else if (event.key === '?') setModal('help');
      else if (!event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'n') setModal('templates');
      else if (event.key === 'Escape') setSelection(null);
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  const visibleStates = machine.states.filter(s => `${s.name} ${s.id}`.toLowerCase().includes(search.toLowerCase()));
  return <div className={`application ${view === 'runtime' ? 'view-runtime' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-symbol"><i /><i /></span><span>Decouple<span>Flow</span></span><small>α</small></div>
      <div className="sidebar-language"><LanguageSelector /></div>
      <div className="workspace-label"><span>{tr("本地工作空间")}</span><span className="local-dot" /></div>
      <div className="document-picker"><FolderOpen size={16} /><select aria-label={tr("选择状态机")} value={workspace.active} onChange={e => switchDocument(e.target.value)}>{workspace.documents.map(d => <option key={d.key} value={d.key}>{d.project.machine.name || tr("未命名状态机")}</option>)}</select><ChevronDown size={13} /></div>
      <div className="sidebar-create-actions"><button className="new-machine" aria-label={tr("新建状态机")} title={tr("新建状态机")} onClick={() => setModal('templates')}><Plus size={16} />{tr("新建状态机")}<kbd>N</kbd></button><button className="icon-button import-project" title={tr("导入项目")} aria-label={tr("导入项目")} onClick={() => fileInput.current?.click()}><Upload size={17} /></button></div>
      <div className="sidebar-section-title">{tr("添加状态")}<span>{tr("拖拽到画布")}</span></div>
      <div className="state-palette">{STATE_KINDS.map(kind => { const Icon = KIND_ICONS[kind]; return <button className={`palette-item kind-${kind}`} key={kind} onClick={() => addState(kind)} draggable onDragStart={e => { e.dataTransfer.setData('application/decoupleflow-state', kind); e.dataTransfer.effectAllowed = 'copy'; }}><span><Icon size={16} /></span><span>{tr(KIND_LABELS[kind])}</span><Plus size={13} /></button>; })}</div>
      <div className="sidebar-section-title outline-heading">{tr("状态大纲")}<span>{machine.states.length}</span></div>
      <label className="state-search"><Search size={14} /><input aria-label={tr("搜索状态")} value={search} onChange={e => setSearch(e.target.value)} placeholder={tr("搜索状态…")} /></label>
      <div className="state-outline">{visibleStates.map(s => { const Icon = KIND_ICONS[s.kind]; return <button key={s.id} className={selection?.type === 'state' && selection.id === s.id ? 'active' : ''} onClick={() => { select({ type: 'state', id: s.id }); setView('canvas'); }} style={{ paddingLeft: s.parentId ? 23 : undefined }}><Icon size={13} /><span>{s.name || tr("未命名状态")}</span>{machine.initialState === s.id && <span className="outline-entry" />}</button>; })}{!visibleStates.length && <p className="outline-empty">{search ? tr("没有匹配的状态") : tr("还没有添加状态")}</p>}</div>
      <div className="sidebar-bottom"><div className="sidebar-note"><span><Package size={17} /></span><div><strong>{tr("设计一次，随处使用")}</strong><p>{tr("把工作方法带到你的 Agent")}</p></div></div><div className="sidebar-footer"><span>DecoupleFlow <i>v0.5</i></span><button aria-label={tr("使用帮助")} title={tr("使用帮助")} onClick={() => setModal('help')}><HelpCircle size={17} /></button></div></div>
    </aside>
    <div className="workspace">
      <header className="topbar"><div className="breadcrumbs"><span>{tr("工作空间")}</span><span>/</span><button onClick={() => { setSelection(null); setInspectorOpen(true); }}>{machine.name || tr("未命名状态机")}</button><span className="version-pill">v{machine.version || '—'}</span></div><div className="topbar-actions"><span className={`save-state ${workspace.saveStatus}`}>{workspace.saveStatus === 'saved' ? <CheckCircle2 size={13} /> : workspace.saveStatus === 'saving' ? <Loader2 size={13} className="spin" /> : <AlertCircle size={13} />}{workspace.saveStatus === 'saved' ? tr("已保存在本机") : workspace.saveStatus === 'saving' ? tr("保存中") : tr("本机存储已满，请导出")}</span><div className="toolbar-divider" /><button className="icon-button" title={tr("撤销 Ctrl+Z")} aria-label={tr("撤销")} disabled={!workspace.canUndo} onClick={workspace.undo}><Undo2 size={17} /></button><button className="icon-button" title={tr("重做 Ctrl+Shift+Z")} aria-label={tr("重做")} disabled={!workspace.canRedo} onClick={workspace.redo}><Redo2 size={17} /></button><button className="button compact project-save" title={tr("保存文件")} aria-label={tr("保存文件")} onClick={exportProject}><Save size={15} /><span>{tr("保存文件")}</span></button><button className="button primary compact export-open" title={tr("导出 / 接入")} aria-label={tr("导出 / 接入")} onClick={openExport}><Package size={15} /><span className="export-button-label">{tr("导出 / 接入")}</span><ArrowUpRight size={14} /></button></div></header>
      <div className="workspace-main">
        <main className="editor-main">
          <div className="document-header"><div className="document-title"><span className="document-icon"><Workflow size={22} /></span><div><div className="document-eyebrow">{tr('状态机概览')} <span>{tr("独立设计 · 自由使用")}</span></div><h1>{machine.name || tr("未命名状态机")}</h1><p>{machine.purpose || tr("把复杂工作，写成 Agent 能理解的状态与条件。")}</p></div></div><button className="icon-button" title={tr("移除此状态机")} aria-label={tr("移除此状态机")} onClick={() => setModal('delete-document')}><MoreHorizontal size={19} /></button></div>
          <div className="view-toolbar"><div className="view-tabs">{([{ id: 'canvas', name: tr("状态机"), icon: GitBranch }, { id: 'description', name: tr("描述预览"), icon: FileText }, { id: 'skill', name: tr("Skill 文件"), icon: Package }, { id: 'runtime', name: tr("推进"), icon: ArrowRight }] as const).map(item => <button key={item.id} className={view === item.id ? 'active' : ''} onClick={() => setView(item.id)}><item.icon size={15} />{item.name}</button>)}</div><div className="view-toolbar-right"><button className={`validation-pill ${errors.length ? 'invalid' : warnings.length ? 'warning' : 'valid'}`} onClick={() => setModal('diagnostics')}>{errors.length ? <AlertCircle size={13} /> : <ShieldCheck size={13} />}{errors.length ? tr("{0} 个问题", { "0": errors.length }) : warnings.length ? tr("{0} 条建议", { "0": warnings.length }) : tr("结构完整")}</button><span className="state-count">{machine.states.length} {tr(" 状态")}<span>·</span>{machine.transitions.length} {tr(" 跳转")}</span><button className={`icon-button ${inspectorOpen ? 'pressed' : ''}`} aria-label={tr("切换属性面板")} title={tr("切换属性面板")} onClick={() => setInspectorOpen(v => !v)}><PanelRight size={17} /></button></div></div>
          {view === 'canvas' && <Canvas key={workspace.active} project={project} documentKey={workspace.active} selection={selection} onSelect={select} onAdd={addState} onMove={(id, pos) => workspace.edit(d => { d.layout[id] = { ...positionOf(d, id), ...pos }; }, undefined, true)} onConnect={connect} onDragStart={workspace.checkpoint} onToggle={id => workspace.edit(d => { const p = positionOf(d, id); d.layout[id] = { ...p, collapsed: !p.collapsed }; })} onArrange={arrange} />}
          {view === 'runtime' && (bundle ? <RuntimePanel key={`${workspace.active}-${bundle.semanticHash}`} machine={machine} project={project} definitionHash={bundle.semanticHash} documentKey={workspace.active} info={localInfo} onDriver={driver => workspace.edit(d => { d.machine.driver = driver; }, 'driver')} onVisualization={value => workspace.edit(d => { d.machine.visualization = value; }, 'visualization')} notify={notify} /> : <div className="empty-state">{bundleError || tr("正在准备实例…")}</div>)}
          {view === 'description' && <section className="description-view"><div className="preview-toolbar"><div className="segmented"><button className={descriptionMode === 'read' ? 'active' : ''} onClick={() => setDescriptionMode('read')}><BookOpen size={13} />{tr("阅读")}</button><button className={descriptionMode === 'source' ? 'active' : ''} onClick={() => setDescriptionMode('source')}>Markdown</button><button className={descriptionMode === 'xml' ? 'active' : ''} onClick={() => setDescriptionMode('xml')}>{tr("标签描述")}</button></div><div><button className="text-button" onClick={() => void copyText(descriptionMode === 'xml' ? descriptions.xml : descriptions.markdown).then(() => notify(tr("描述已复制。"))).catch(e => notify(e.message, true))}><Copy size={14} />{tr("复制")}</button><button className="text-button" onClick={() => downloadFile(descriptionMode === 'xml' ? descriptions.xml : descriptions.markdown, `${machine.id}.${descriptionMode === 'xml' ? 'xml' : 'md'}`, 'text/plain;charset=utf-8')}><Download size={14} />{tr("下载")}</button></div></div>{descriptionMode === 'read' ? <article className="markdown-document"><MarkdownDocument>{descriptions.markdown}</MarkdownDocument></article> : <pre className="source-document">{descriptionMode === 'xml' ? descriptions.xml : descriptions.markdown}</pre>}</section>}
          {view === 'skill' && <section className="skill-view"><div className="skill-view-banner"><span><Package size={20} /></span><div><strong>{tr("一份状态机，一个独立 Skill")}</strong><p>{tr("描述、定义和状态记录模板都在这里。安装后，由你的 Agent 自己使用。")}</p></div><button className="button small" onClick={openExport}>{tr("导出与安装")}<ArrowUpRight size={14} /></button></div>{bundle ? <FilePreview bundle={bundle} active={activeFile} onSelect={setActiveFile} /> : <div className="empty-preview">{bundleError ? <AlertCircle size={25} /> : <Loader2 size={25} className="spin" />}<p>{bundleError || tr("正在生成 Skill…")}</p>{bundleError && <button className="button" onClick={() => setModal('diagnostics')}>{tr("查看结构问题")}</button>}</div>}</section>}
          <footer className="workspace-status"><span><span className="status-light" />{tr("状态机描述与 Skill 编辑器")}</span><span>{tr("本地存储")}<span className="status-separator">/</span>{machine.driver?.type === 'jev' ? tr("Jev Adapter · 按需调用") : tr("自己的 Agent")}<span className="status-separator">/</span><button onClick={() => setModal('help')}>{tr("快捷键 ")}<kbd>?</kbd></button></span></footer>
        </main>
        {inspectorOpen && view !== 'runtime' && <Inspector machine={machine} selection={selection} updateMachine={updateMachine} updateState={updateState} updateTransition={updateTransition} onSelect={select} onDelete={removeSelection} onDuplicate={duplicate} onParentChange={changeParent} onAddTransition={addTransition} onRemoveTransition={id => workspace.edit(d => { d.machine.transitions = d.machine.transitions.filter(t => t.id !== id); })} />}
      </div>
    </div>
    <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label={tr("选择项目文件")} onChange={e => void importFile(e.target.files?.[0])} />
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <AlertCircle size={17} /> : <CheckCircle2 size={17} />}<span>{system(toast.message)}</span><button aria-label={tr("关闭通知")} onClick={() => setToast(null)}><X size={14} /></button></div>}
    {modal === 'export' && bundle && <ExportDialog machine={machine} bundle={bundle} info={localInfo} onClose={closeModal} notify={notify} />}
    {modal === 'templates' && <Modal title={tr("从一个好起点开始")} subtitle={tr("选择熟悉的工作模式，再把它变成你自己的状态机。")} onClose={closeModal} className="templates-modal"><div className="template-grid">{TEMPLATES.map(t => <button key={t.id} className="template-card" onClick={() => create(t.id)}><div className={`template-drawing drawing-${t.id === 'blank' ? 3 : t.id === 'review' || t.id === 'research' ? 1 : 0}`}><i /><b /><i /><b /><i /></div><span className="template-count">{t.id === 'bugfix' || t.id === 'research' || t.id === 'release' ? 'DEMO · ' : ''}{tr(t.count)}</span><h3>{tr(t.name)}<ArrowUpRight size={16} /></h3><p>{tr(t.description)}</p></button>)}</div></Modal>}
    {modal === 'diagnostics' && <Modal title={tr("状态机检查")} subtitle={tr("检查结构与描述完整性。自然语言条件由宿主 Agent 根据实际证据判断。")} onClose={closeModal} className="diagnostics-modal"><div className="diagnostic-summary"><span><strong>{errors.length}</strong> {tr(" 个结构问题")}</span><span><strong>{warnings.length}</strong> {tr(" 条改进建议")}</span></div><div className="diagnostic-list">{diagnostics.length ? diagnostics.map((d, index) => <button key={`${d.code}-${index}`} className={`diagnostic-item ${d.level}`} onClick={() => { if (d.stateId || d.transitionId) select({ type: d.stateId ? 'state' : 'transition', id: d.stateId ?? d.transitionId! }); else { setSelection(null); setInspectorOpen(true); } setView('canvas'); setModal(null); }}>{d.level === 'error' ? <AlertCircle size={17} /> : <Sparkles size={17} />}<span>{d.message}</span><ArrowUpRight size={14} /></button>) : <div className="validation-success"><CheckCircle2 size={36} /><h3>{tr("状态机结构完整")}</h3><p>{tr("现在可以预览描述，并导出到你的 Agent。")}</p></div>}</div><div className="modal-footer"><button className="button" onClick={closeModal}>{tr("继续编辑")}</button><button className="button primary" disabled={!!errors.length || !bundle} onClick={() => setModal('export')}><Package size={15} />{tr("导出 / 接入")}</button></div></Modal>}
    {modal === 'help' && <Modal title={tr("让状态机成为 Agent 的工作笔记")} subtitle={tr("编辑状态与条件，导出独立 Skill，在已有 Agent 中完成实际任务。")} onClose={closeModal} className="help-modal"><div className="help-content"><div className="help-steps"><span>01 <strong>{tr("定义状态")}</strong><small>{tr("从左侧添加节点，描述当前工作。")}</small></span><ArrowRight size={16} /><span>02 <strong>{tr("连接条件")}</strong><small>{tr("拖动圆点连接状态，填写跳转依据。")}</small></span><ArrowRight size={16} /><span>03 <strong>{tr("交给 Agent")}</strong><small>{tr("导出或安装 Skill，在宿主中使用。")}</small></span></div><div className="shortcut-list"><span>{tr("撤销 / 重做")}<kbd>Ctrl / ⌘ + Z / Shift Z</kbd></span><span>{tr("保存项目文件")}<kbd>Ctrl / ⌘ + S</kbd></span><span>{tr("复制选中状态")}<kbd>Ctrl / ⌘ + D</kbd></span><span>{tr("删除选中元素")}<kbd>Delete</kbd></span><span>{tr("新建状态机")}<kbd>N</kbd></span></div><p className="panel-hint">{tr("导出 ZIP 包含状态机描述、定义、Skill 说明和记录模板。本地安装只写入你选择的技能目录，不启动 Agent 或业务工具。")}</p><p className="panel-hint">{tr("浏览器记录仅保存在当前设备与地址。定期保存项目 JSON，可在其他浏览器导入继续编辑。")}</p></div></Modal>}
    {modal === 'delete-document' && <Modal title={tr("移除这份状态机？")} subtitle={tr("将从本地工作空间移除「{0}」。已导出的文件与已安装的 Skill 不受影响。", { "0": machine.name })} onClose={closeModal} className="confirm-modal"><div className="modal-footer"><button className="button" onClick={exportProject}><Download size={15} />{tr("先保存文件")}</button><button className="button" onClick={closeModal}>{tr("取消")}</button><button className="button destructive" onClick={() => { workspace.remove(workspace.active); setSelection(null); setModal(null); notify(tr("状态机已从工作空间移除。")); }}><Trash2 size={15} />{tr("移除")}</button></div></Modal>}
  </div>;
}

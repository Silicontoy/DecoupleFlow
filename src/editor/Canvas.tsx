import { useI18n } from '../i18n';
import { memo, useEffect, useMemo, useState } from 'react';
import { Background, BackgroundVariant, BaseEdge, EdgeLabelRenderer, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, getSmoothStepPath, useReactFlow, useUpdateNodeInternals, useViewport, type Connection, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps } from '@xyflow/react';
import { ArrowDownToLine, ArrowUpRight, Check, ChevronDown, ChevronRight, Circle, Clock3, Focus, GitBranch, Layers, ListOrdered, Minus, Plus, Repeat2, ScanLine, ShieldCheck, Square, Workflow } from 'lucide-react';
import { KIND_LABELS, LOOP_ROLE_LABELS, isBranchState, type Machine, type Project, type State, type StateKind, type Transition } from '../domain/types';
import '@xyflow/react/dist/style.css';
import { connectionPorts } from './connections';

export const KIND_ICONS = { task: Square, list: ListOrdered, decision: GitBranch, loop: Repeat2, wait: Clock3, end: Check, subflow: Layers };
export type Selection = { type: 'state' | 'transition'; id: string } | null;
type PortRoute = { transition: Transition; peer: string };
type StateData = { state: State; initial: boolean; collapsed: boolean; childCount: number; incoming: PortRoute[]; outgoing: PortRoute[]; toggle: () => void; selectTransition: (id: string) => void; [key: string]: unknown };
export type ExecutionOverlay = { states: Record<string, string>; activeTransition?: string; visitedTransitions: string[]; paused: boolean };
type StateNode = Node<StateData>;
const COLORS: Record<StateKind, string> = { task: '#4d94db', list: '#478f98', decision: '#9980d4', loop: '#d18464', wait: '#d5a047', end: '#55a492', subflow: '#758cca' };
export function stateCardSize(state: State, machine: Machine) {
  if (state.kind === 'list') return { width: 280, height: 160 + Math.min(state.list?.items.length ?? 0, 3) * 25 + ((state.list?.items.length ?? 0) > 3 ? 20 : 0) };
  const rows = Math.max(1, machine.transitions.filter(t => t.to === state.id).length, machine.transitions.filter(t => t.from === state.id).length);
  return isBranchState(state) ? { width: 320, height: 158 + rows * 42 } : { width: 242, height: 142 };
}

const StateCard = memo(function StateCard({ id, data, selected }: NodeProps<StateNode>) {
  const { t: tr } = useI18n();
  const { state, initial, collapsed, childCount, incoming, outgoing } = data;
  const Icon = KIND_ICONS[state.kind];
  const expanded = state.kind === 'subflow' && !collapsed;
  const branch = isBranchState(state);
  const updateNodeInternals = useUpdateNodeInternals();
  const portKey = `${state.kind}:${incoming.map(r => r.transition.id).join(',')}:${outgoing.map(r => r.transition.id).join(',')}`;
  useEffect(() => { updateNodeInternals(id); }, [id, portKey, updateNodeInternals]);
  return <div className={`state-card kind-${state.kind} ${branch ? 'branch-state' : ''} ${selected ? 'selected' : ''} ${expanded ? 'subflow-expanded' : ''} ${data.execution ? `execution-${data.execution}` : ''}`} data-testid={`state-${state.id}`} data-execution-status={data.execution ? String(data.execution) : undefined}>
    <Handle type="target" position={Position.Left} id="in" style={branch ? { top: 28 } : undefined} title={tr("连接新的入路")} />
    <Handle type="target" position={Position.Top} id="in-top" title={tr("连接新的入路")} />
    <div className="state-card-heading"><span className="state-kind-icon"><Icon size={16} strokeWidth={1.8} /></span><span className="state-kind-label">{tr(KIND_LABELS[state.kind])}</span>{initial && <span className="entry-tag"><span />{tr("入口")}</span>}{state.kind === 'subflow' && <button className="fold-button nodrag" aria-label={collapsed ? tr("展开子状态机") : tr("折叠子状态机")} onClick={data.toggle}>{collapsed ? <ChevronRight size={15} /> : <ChevronDown size={15} />}</button>}</div>
    <div className="state-card-name">{state.name || tr("未命名状态")}</div>
    {!expanded && <div className="state-card-description">{state.description || tr("点击编辑状态说明与条件")}</div>}
    {state.kind === 'list' && <div className="state-list-preview"><ol>{state.list?.items.slice(0, 3).map(item => <li key={item.id} title={item.text}>{item.text || tr("待填写事项")}</li>)}</ol>{(state.list?.items.length ?? 0) > 3 && <small>{tr("另有 {0} 项", { "0": state.list!.items.length - 3 })}</small>}<span>{tr("共 {0} 项 · 逐项通过后出口", { "0": state.list?.items.length ?? 0 })}</span></div>}
    {branch && <>
      <div className="port-columns-heading"><span>{incoming.length} {tr(" 条入路")}</span><span>{outgoing.length} {tr(" 条条件出路")}</span></div>
      <div className="port-grid">{Array.from({ length: Math.max(1, incoming.length, outgoing.length) }, (_, index) => <div className="port-row" key={index}>
        <div className="port-cell">{incoming[index] ? <>
          <Handle type="target" position={Position.Left} id={`route-in-${incoming[index].transition.id}`} style={{ left: -20 }} title={tr("来自 {0}；可连接新的入路", { "0": incoming[index].peer })} />
          <button className="port-route nodrag nopan incoming" title={`${incoming[index].peer}：${incoming[index].transition.condition || tr("条件待补充")}`} onClick={e => { e.stopPropagation(); data.selectTransition(incoming[index].transition.id); }}><strong>{incoming[index].peer}</strong><small>{incoming[index].transition.condition || tr("条件待补充")}</small></button>
        </> : <span className="port-placeholder">{index === 0 ? tr("从入点连接状态") : '—'}</span>}</div>
        <div className="port-cell">{outgoing[index] ? <>
          <Handle type="source" position={Position.Right} id={`route-out-${outgoing[index].transition.id}`} style={{ right: -20 }} title={tr("拖动可修改此路径的目标")} />
          <button className={`port-route nodrag nopan outgoing ${outgoing[index].transition.loopRole ?? ''}`} title={`${outgoing[index].transition.condition || tr("条件待补充")} → ${outgoing[index].peer}`} onClick={e => { e.stopPropagation(); data.selectTransition(outgoing[index].transition.id); }}><strong>{outgoing[index].transition.condition || tr("填写路径条件")}</strong><small>{outgoing[index].transition.loopRole ? `${tr(LOOP_ROLE_LABELS[outgoing[index].transition.loopRole!])} · ` : '→ '}{outgoing[index].peer}</small></button>
        </> : <span className="port-placeholder">{index === 0 ? tr("从出点添加条件路径") : '—'}</span>}</div>
      </div>)}</div>
    </>}
    <div className="state-card-footer"><span>{state.kind === 'subflow' ? tr("{0} 个内部状态", { "0": childCount }) : state.id}</span><span>{state.qualityConditions.length > 0 && <><ShieldCheck size={12} />{state.qualityConditions.length}</>}{state.kind !== 'end' && <><ArrowUpRight size={12} />{outgoing.length}</>}</span></div>
    {state.kind !== 'end' && <Handle type="source" position={Position.Right} id="out" style={branch ? { top: 28 } : undefined} title={tr("拖出新的条件路径")} />}
    {state.kind !== 'end' && <Handle type="source" position={Position.Bottom} id="out-bottom" title={tr("拖出新的条件路径")} />}
  </div>;
});

function TransitionEdge(props: EdgeProps) {
  const { t: tr } = useI18n();
  const { sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, id, data } = props;
  const fallback = data?.kind === 'fallback';
  const active = data?.active === true, visited = data?.visited === true;
  const self = props.source === props.target;
  const [normalPath, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 18, offset: 35 });
  const path = self ? `M${sourceX},${sourceY} C${sourceX + 130},${sourceY - 190} ${targetX - 130},${targetY - 190} ${targetX},${targetY}` : normalPath;
  return <>
    <BaseEdge id={id} data-source-handle={props.sourceHandleId} data-target-handle={props.targetHandleId} path={path} markerEnd={props.markerEnd} className={active ? 'execution-path-active' : undefined} style={{ stroke: active ? '#26a17b' : visited ? '#82b5a0' : selected ? '#168d7e' : fallback ? '#c2a572' : '#9eafba', strokeWidth: active ? 3 : selected ? 2.2 : 1.5, strokeDasharray: active ? '8 5' : fallback ? '5 4' : undefined }} interactionWidth={28} />
    <EdgeLabelRenderer><button className={`transition-label nodrag nopan ${selected ? 'selected' : ''} ${fallback ? 'fallback' : ''}`} style={{ transform: `translate(-50%, -50%) translate(${self ? (sourceX + targetX) / 2 : labelX}px,${self ? sourceY - 145 : labelY}px)` }} onClick={e => { e.stopPropagation(); (data?.select as (() => void) | undefined)?.(); }} data-testid={`edge-${id}`}>{String(props.label || tr("填写跳转条件"))}{selected && <ArrowUpRight size={11} />}</button></EdgeLabelRenderer>
  </>;
}
const nodeTypes = { state: StateCard };
const edgeTypes = { transition: TransitionEdge };

function CanvasTools({ onArrange, readOnly }: { onArrange: () => void; readOnly?: boolean }) {
  const { t: tr } = useI18n();
  const rf = useReactFlow(); const { zoom } = useViewport();
  return <div className="canvas-tools"><button title={tr("缩小")} aria-label={tr("缩小")} onClick={() => void rf.zoomOut()}><Minus size={16} /></button><span>{Math.round(zoom * 100)}%</span><button title={tr("放大")} aria-label={tr("放大")} onClick={() => void rf.zoomIn()}><Plus size={16} /></button><i /><button title={tr("适应画布")} aria-label={tr("适应画布")} onClick={() => void rf.fitView({ padding: .2, duration: 300 })}><Focus size={17} /></button>{!readOnly && <button title={tr("整理布局")} aria-label={tr("整理布局")} onClick={onArrange}><ScanLine size={17} /></button>}</div>;
}
export function positionOf(project: Project, id: string) { return Object.hasOwn(project.layout, id) ? project.layout[id] : { x: 60, y: 100 }; }
type Props = { project: Project; documentKey: string; selection: Selection; onSelect: (selection: Selection) => void; onMove: (id: string, position: { x: number; y: number }) => void; onConnect: (connection: Connection) => void; onDragStart: () => void; onToggle: (id: string) => void; onArrange: () => void; onAdd: (kind: StateKind, position?: { x: number; y: number }) => void; readOnly?: boolean; execution?: ExecutionOverlay };
function Graph(props: Props) {
  const { t: tr } = useI18n();
  const { project, selection, onSelect } = props;
  const rf = useReactFlow();
  // Controlled nodes must retain measured dimensions so React Flow keeps their handle bounds.
  // These measurements belong to the canvas, not the saved state-machine definition.
  const [measurements, setMeasurements] = useState<Record<string, { width: number; height: number }>>({});
  const nodes = useMemo(() => {
    const states = new Map(project.machine.states.map(s => [s.id, s]));
    const dimensions = (id: string, seen = new Set<string>()): { width: number; height: number } => {
      const state = states.get(id);
      if (!state || seen.has(id)) return { width: 242, height: 142 };
      if (state.kind !== 'subflow' || positionOf(project, id).collapsed) return stateCardSize(state, project.machine);
      seen.add(id);
      let width = 650, height = 340;
      for (const child of project.machine.states.filter(s => s.parentId === id)) {
        const size = dimensions(child.id, new Set(seen)), point = positionOf(project, child.id);
        width = Math.max(width, point.x + size.width + 28); height = Math.max(height, point.y + size.height + 28);
      }
      return { width, height };
    };
    const hasValidParent = (state: State) => {
      const seen = new Set([state.id]); let id = state.parentId;
      if (!id) return false;
      while (id) { const parent = states.get(id); if (!parent || parent.kind !== 'subflow' || seen.has(id)) return false; seen.add(id); id = parent.parentId; }
      return true;
    };
    const depth = (id: string, seen = new Set<string>()): number => { if (seen.has(id)) return 0; seen.add(id); const parent = states.get(id)?.parentId; return parent ? 1 + depth(parent, seen) : 0; };
    const hidden = (state: State) => { const seen = new Set<string>(); let parent = state.parentId; while (parent && !seen.has(parent)) { seen.add(parent); if (positionOf(project, parent).collapsed) return true; parent = states.get(parent)?.parentId ?? null; } return false; };
    return [...project.machine.states].sort((a, b) => depth(a.id) - depth(b.id)).map((state): StateNode => {
      const layout = positionOf(project, state.id), size = dimensions(state.id);
      return { id: state.id, type: 'state', position: { x: layout.x, y: layout.y }, measured: measurements[state.id], parentId: hasValidParent(state) ? state.parentId! : undefined, hidden: hidden(state), selected: selection?.type === 'state' && selection.id === state.id, ...size, style: size, data: { state, execution: props.execution?.states[state.id], initial: project.machine.initialState === state.id || !!state.parentId && states.get(state.parentId)?.initialState === state.id, collapsed: !!layout.collapsed, childCount: project.machine.states.filter(s => s.parentId === state.id).length, incoming: project.machine.transitions.filter(t => t.to === state.id).map(t => ({ transition: t, peer: states.get(t.from)?.name || t.from })), outgoing: project.machine.transitions.filter(t => t.from === state.id).map(t => ({ transition: t, peer: states.get(t.to)?.name || t.to })), selectTransition: id => onSelect({ type: 'transition', id }), toggle: () => props.onToggle(state.id) } };
    });
  }, [project, selection, props.onToggle, props.execution, onSelect, measurements]);
  const edges: Edge[] = project.machine.transitions.filter(t => nodes.some(n => n.id === t.from) && nodes.some(n => n.id === t.to)).map(t => {
    const source = nodes.find(n => n.id === t.from)!, target = nodes.find(n => n.id === t.to)!;
    const ports = connectionPorts(project, t);
    return { id: t.id, source: t.from, target: t.to, type: 'transition', sourceHandle: isBranchState(source.data.state) ? `route-out-${t.id}` : ports.sourceHandle, targetHandle: isBranchState(target.data.state) ? `route-in-${t.id}` : ports.targetHandle, label: t.condition, selected: selection?.type === 'transition' && selection.id === t.id, hidden: source.hidden || target.hidden, markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: t.kind === 'fallback' ? '#c2a572' : '#9eafba' }, data: { kind: t.kind, active: props.execution?.activeTransition === t.id && !props.execution.paused, visited: props.execution?.visitedTransitions.includes(t.id), select: () => onSelect({ type: 'transition', id: t.id }) } };
  });
  useEffect(() => { const timer = setTimeout(() => { void rf.fitView({ padding: .19, maxZoom: 1, duration: 200 }); }, 80); return () => clearTimeout(timer); }, [props.documentKey, nodes.length, rf]);
  const onChanges = (changes: NodeChange<StateNode>[]) => {
    if (changes.some(change => change.type === 'dimensions' && change.dimensions)) {
      setMeasurements(previous => {
        let next = previous;
        for (const change of changes) {
          if (change.type !== 'dimensions' || !change.dimensions) continue;
          const before = previous[change.id];
          if (before?.width !== change.dimensions.width || before?.height !== change.dimensions.height) next = { ...next, [change.id]: change.dimensions };
        }
        return next;
      });
    }
    if (props.readOnly) return;
    for (const change of changes) if (change.type === 'position' && change.position) props.onMove(change.id, change.position);
  };
  return <div className={`canvas-shell ${props.readOnly ? 'execution-canvas' : ''}`} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => { e.preventDefault(); if (props.readOnly) return; const kind = e.dataTransfer.getData('application/decoupleflow-state') as StateKind; if (kind && kind in KIND_LABELS) props.onAdd(kind, rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })); }}>
    <ReactFlow nodesDraggable={!props.readOnly} nodesConnectable={!props.readOnly} nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onNodesChange={onChanges} onNodeClick={(_, node) => onSelect({ type: 'state', id: node.id })} onEdgeClick={(_, edge) => onSelect({ type: 'transition', id: edge.id })} onPaneClick={() => onSelect(null)} onNodeDragStart={props.onDragStart} onConnect={props.onConnect} fitView fitViewOptions={{ padding: .19, maxZoom: 1 }} minZoom={.15} maxZoom={1.8} deleteKeyCode={null} selectionKeyCode="Shift" panOnScroll selectionOnDrag={false} defaultEdgeOptions={{ type: 'transition' }}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#cbd4da" />
      <MiniMap pannable zoomable nodeColor={n => COLORS[(n.data as StateData).state.kind]} maskColor="rgba(245,248,250,.75)" style={{ width: 146, height: 94 }} />
      <CanvasTools onArrange={props.onArrange} readOnly={props.readOnly} />
    </ReactFlow>
    {!nodes.length && <div className="empty-canvas"><span><Workflow size={32} /></span><h2>{tr("从第一个状态开始")}</h2><p>{tr("点击左侧组件，或把它拖到画布上。")}</p><button className="button primary" onClick={() => props.onAdd('task')}><Plus size={16} />{tr("添加工作状态")}</button></div>}
    <div className="canvas-legend"><Circle size={8} fill="currentColor" />{props.readOnly ? tr("实时状态 · 可缩放查看完整路径") : tr("拖动状态 · 从圆点连接 · 点击编辑")}</div>
    <div className="canvas-caption"><ArrowDownToLine size={13} />{props.readOnly ? tr("由真实事件更新") : tr("编辑状态机，交给你的 Agent")}</div>
  </div>;
}
export function Canvas(props: Props) { return <ReactFlowProvider><Graph {...props} /></ReactFlowProvider>; }

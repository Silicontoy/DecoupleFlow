import { ListProgress } from './ListProgress';
import { translator } from '../i18n/translate';
import { useI18n } from '../i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Bot, CheckCircle2, Copy, Download, Loader2, Play, RotateCcw, ShieldCheck, Zap } from 'lucide-react';
import { driverOf, visualizationOf, type Visualization, type Driver, type Machine, type Project } from '../domain/types';
import { createRuntime, type DecisionResult, type RunRecord } from '../domain/runtime';
import { copyText, downloadFile, localRequest, type LocalInfo } from '../lib/files';
import { useLiveRun } from '../lib/useLiveRun';
import { ExecutionDashboard } from './ExecutionDashboard';
import { archiveInstance, readArchives, restoreInstance, type ArchivedInstance } from '../lib/instanceStore';
import { Modal } from './Modal';
import { Field } from './Inspector';

export function RuntimePanel({ machine, project, definitionHash, documentKey, info, onDriver, onVisualization, notify }: { machine: Machine; project: Project; definitionHash: string; documentKey: string; info: LocalInfo | null; onDriver: (driver: Driver) => void; onVisualization: (value: Visualization) => void; notify: (message: string, error?: boolean) => void }) {
  const { t: tr, language, system } = useI18n();
  const runtime = useMemo(() => createRuntime(translator(language)), [language]);
  const driver = driverOf(machine);
  const [modelDraft, setModelDraft] = useState(driver.model);
  const [confidenceDraft, setConfidenceDraft] = useState(String(driver.minConfidence));
  const [probabilityDraft, setProbabilityDraft] = useState(String(driver.minProbability));
  const storageKey = `decoupleflow.instance.${documentKey}`;
  const [record, setRecord] = useState<RunRecord>(() => restoreInstance(machine, definitionHash, storageKey));
  const [archives, setArchives] = useState<ArchivedInstance[]>(() => { try { return readArchives(storageKey); } catch { return []; } });
  const [viewingArchive, setViewingArchive] = useState<ArchivedInstance | null>(null);
  const visualization = visualizationOf(machine);
  const [previousRecord, setPreviousRecord] = useState<string | null>(() => { try { return localStorage.getItem(`${storageKey}.previous`); } catch { return null; } });
  const [context, setContext] = useState('');
  const [agentDecision, setAgentDecision] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DecisionResult | null>(null);
  const [error, setError] = useState('');
  const [eventText, setEventText] = useState('');
  const [injecting, setInjecting] = useState(false);
  const live = useLiveRun(machine, record, info);
  const handledEvidence = useRef(0);
  useEffect(() => { if (live.snapshot) { setRecord(live.snapshot.record); setResult(live.snapshot.result); if (live.snapshot.context) setContext(live.snapshot.context); if (live.snapshot.decision) setAgentDecision(JSON.stringify(live.snapshot.decision, null, 2)); } }, [live.snapshot]);
  const pending = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  useEffect(() => {
    try {
      if (record.status === 'completed' || live.snapshot?.archivedAt) setArchives(archiveInstance(storageKey, { record, project, snapshot: live.snapshot ?? undefined, reason: live.snapshot?.archiveReason || tr("实例已完成") }));
      else localStorage.setItem(storageKey, JSON.stringify(record));
    }
    catch { notify(tr("实例未能保存到浏览器，请下载实例记录。"), true); }
  }, [storageKey, record, project, live.snapshot, notify]);
  const current = runtime.getState(machine, record.currentState);
  const choices = runtime.candidates(machine, record);
  const updateDriver = (update: Partial<Driver>) => onDriver({ ...driver, ...update });
  const ready = !!live.snapshot && !live.snapshot.archivedAt && !busy && record.status !== 'completed' && !!choices.length && (driver.type === 'jev' ? !!context.trim() && !!info && (!!apiKey.trim() || !!info.jevConfigured) : !!agentDecision.trim());
  const apply = async (singleStep = true) => {
    if (busy || record.status === 'completed' || !!live.snapshot?.archivedAt || live.snapshot?.archivedAt) return;
    setError(''); setBusy(true); setResult(null);
    const revision = live.snapshot?.record.revision ?? record.revision;
    if (!singleStep) handledEvidence.current = live.snapshot?.evidenceSeq ?? handledEvidence.current;
    const controller = new AbortController(); pending.current = controller;
    try {
      if (!info || !live.snapshot) throw new Error(tr("运行实例尚未连接，请稍后重试。"));
      let decision: unknown;
      if (driver.type === 'agent') {
        try { decision = JSON.parse(agentDecision); } catch { throw new Error(tr("请粘贴 Agent 返回的 JSON 决策。")); }
      }
      const snapshot = await localRequest('/api/runs/step', { runId: record.instanceId, expectedRevision: revision, context: !singleStep && live.snapshot.context ? live.snapshot.context : context, decision: !singleStep && live.snapshot.decision ? live.snapshot.decision : decision, singleStep, ...(apiKey.trim() ? { apiKey } : {}) }, info, controller.signal);
      if (!snapshot || snapshot.runId !== record.instanceId || !Array.isArray(snapshot.events) || !snapshot.result) throw new Error(tr("运行接口未返回完整结果，当前位置未改变。"));
      const next: DecisionResult = snapshot.result;
      live.setSnapshot(snapshot);
      if (!mounted.current || controller.signal.aborted) return;
      runtime.assertRecord(machine, next.record, definitionHash);
      if (next.record.revision < revision || next.record.revision > revision + 1) throw new Error(tr("收到过期的判断结果，未更新实例。"));
      setResult(next); setRecord(next.record);
      if (next.status !== 'held') { setContext(''); setAgentDecision(''); }
    } catch (failure) { if (mounted.current && !controller.signal.aborted) setError((failure as Error).message); }
    finally { if (mounted.current) setBusy(false); pending.current = null; }
  };
  useEffect(() => {
    const state = live.snapshot;
    if (state?.auto && !state.paused && !state.busy && ready && state.evidenceSeq > handledEvidence.current) { handledEvidence.current = state.evidenceSeq; void apply(false); }
  }, [live.snapshot, ready]);
  const control = async (action: 'pause' | 'continue' | 'fork') => {
    if (!info || !live.snapshot) return;
    try {
      const response = await localRequest('/api/runs/control', { runId: record.instanceId, action, expectedRevision: record.revision }, info);
      if (action === 'fork') { setPreviousRecord(JSON.stringify(record)); localStorage.setItem(`${storageKey}.previous`, JSON.stringify(record)); setRecord(response.snapshot.record); setContext(response.snapshot.context); setAgentDecision(''); setResult(null); handledEvidence.current = 0; notify(tr("已从当前位置创建独立分叉，原实例保留。")); }
      else { live.setSnapshot(response.snapshot); if (action === 'continue' && ready && !response.snapshot.busy) void apply(false); }
    } catch (e) { setError((e as Error).message); }
  };
  const archiveCurrent = async () => {
    let snapshot = live.snapshot;
    if (snapshot && !snapshot.archivedAt && info) {
      const response = await localRequest('/api/runs/control', { runId: record.instanceId, action: 'archive', expectedRevision: record.revision }, info);
      snapshot = response.snapshot; live.setSnapshot(snapshot);
    }
    setArchives(archiveInstance(storageKey, { record, project, snapshot: snapshot ?? undefined, reason: snapshot?.archiveReason || tr("用户结束本次实例") }));
  };
  const restart = async () => {
    try {
      await archiveCurrent();
      setRecord(runtime.initialRecord(machine, definitionHash, crypto.randomUUID())); setContext(''); setAgentDecision(''); setResult(null); setError(''); handledEvidence.current = 0;
      notify(tr("旧实例已归档，新一轮从入口开始。"));
    } catch (e) { setError((e as Error).message); }
  };
  const inject = async () => {
    if (!info || !live.snapshot) return;
    try {
      const event = JSON.parse(eventText);
      const snapshot = await localRequest('/api/runs/event', { ...event, runId: record.instanceId, expectedRevision: record.revision }, info);
      live.setSnapshot(snapshot); setInjecting(false); setError('');
    } catch (e) { setError((e as Error).message); }
  };
  const connection = () => ({ endpoint: `${window.location.origin}/api/runs/event`, readEndpoint: `${window.location.origin}/api/runs/snapshot`, readBody: { runId: record.instanceId }, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DecoupleFlow-Run-Token': live.eventToken }, body: { runId: record.instanceId, expectedRevision: record.revision, eventId: crypto.randomUUID(), type: 'agent.completed', actor: tr("填写自己的 Agent 名称"), context: tr("填写本次真实执行结果"), decision: runtime.handoff(machine, record, context).decisionFormat }, note: tr("仅该实例的事件上报与快照读取权限。向 readEndpoint POST readBody，使用相同 headers 获取下一状态和 revision；每次迁移后更新 expectedRevision，eventId 用于去重。决策格式参考当前状态交接包。") });
  const copyConnection = () => void copyText(JSON.stringify(connection(), null, 2)).then(() => notify(tr("当前实例的事件接入信息已复制。"))).catch(e => notify(e.message, true));
  const copyHandoff = () => void copyText(JSON.stringify(runtime.handoff(machine, record, context), null, 2)).then(() => notify(tr("状态、路径条件和决策格式已复制，可交给自己的 Agent。"))).catch(e => notify(e.message, true));
  return <section className="runtime-view">
    <div className="runtime-heading"><div><span className="document-eyebrow">{tr('推进配置')}</span><h2>{tr("执行工作台")}</h2><p>{tr("同一份状态机，自由选择判断方式。Agent 和业务工具负责完成节点内的工作。")}</p></div><span className="runtime-version">{tr("定义 v")}{machine.version}</span></div>
    <details className="driver-settings" open={driver.type === 'jev' ? true : undefined}><summary>{tr("推进设置 · ")}{driver.type === 'jev' ? tr("Jev 官方 Adapter") : tr("自己的 Agent")}</summary>
    <div className="driver-cards" role="group" aria-label={tr("推进方式")}>
      <button className={`driver-card ${driver.type === 'agent' ? 'active' : ''}`} disabled={busy} onClick={() => updateDriver({ type: 'agent' })}><Bot size={23} /><span><strong>{tr("自己的 Agent")}</strong><small>{tr("读取 Skill 和实际上下文，自主检查条件、维护状态。")}</small></span>{driver.type === 'agent' && <CheckCircle2 size={17} />}</button>
      <button className={`driver-card ${driver.type === 'jev' ? 'active' : ''}`} disabled={busy} onClick={() => updateDriver({ type: 'jev' })}><Zap size={23} /><span><strong>Jev <em>{tr("首个官方 Adapter")}</em></strong><small>{tr("由 DecoupleFlow Adapter 调用 TypeSafe Jev，判断条件与下一路径。")}</small></span>{driver.type === 'jev' && <CheckCircle2 size={17} />}</button>
    </div>
    {driver.type === 'jev' && <div className="jev-config"><Field label={tr("Jev 模型")}><input value={modelDraft} disabled={busy} onChange={e => setModelDraft(e.target.value)} onBlur={() => { const model = modelDraft.trim() || 'jev-latest'; if (model !== driver.model) updateDriver({ model }); else setModelDraft(model); }} /></Field><Field label={tr("最低置信度")}><input type="number" min="0.5" max="1" step="0.05" value={confidenceDraft} disabled={busy} onChange={e => setConfidenceDraft(e.target.value)} onBlur={() => { const n = Number(confidenceDraft); if (n >= 0.5 && n <= 1 && n !== driver.minConfidence) updateDriver({ minConfidence: n }); else setConfidenceDraft(String(driver.minConfidence)); }} /></Field><Field label={tr("条件通过概率")}><input type="number" min="0.5" max="1" step="0.05" value={probabilityDraft} disabled={busy} onChange={e => setProbabilityDraft(e.target.value)} onBlur={() => { const n = Number(probabilityDraft); if (n >= 0.5 && n <= 1 && n !== driver.minProbability) updateDriver({ minProbability: n }); else setProbabilityDraft(String(driver.minProbability)); }} /></Field><Field label={tr("当前会话 API Key")} hint={info?.jevConfigured ? tr("本地服务已配置 Key；这里可临时覆盖。") : tr("也可在本地服务设置 TYPESAFE_API_KEY。")}><input type="password" autoComplete="off" placeholder={info?.jevConfigured ? tr("已配置环境变量") : tr("仅保留在当前面板内存中")} value={apiKey} onChange={e => setApiKey(e.target.value)} disabled={busy} /></Field></div>}
    </details>
    <div className="visualization-settings"><div><strong>{tr("Skill 调用时的实时展示")}</strong><p>{tr("设置随 Skill 导出。实际调用时创建独立实例，并通过运行助手更新画布。")}</p></div><label><input type="checkbox" checked={visualization.enabled} onChange={e => onVisualization({ ...visualization, enabled: e.target.checked })} />{tr("启用执行可视化")}</label><label><input type="checkbox" checked={visualization.autoOpen} disabled={!visualization.enabled} onChange={e => onVisualization({ ...visualization, autoOpen: e.target.checked })} />{tr("调用 Skill 时自动打开窗口")}</label><small>{tr("更改后请更新已安装的 Skill；旧版安装包不会自动获得运行助手。")}</small></div>
    {(record.status === 'completed' || live.snapshot?.archivedAt) && <div className="instance-receipt"><strong>{tr("本次实例已归档，活动位置已释放。")}</strong><span>{tr("新任务可开始新一轮；再次进入此页面会从新实例开始。")}</span><button className="button primary" onClick={() => void restart()}>{tr("开始新一轮")}</button></div>}
    <details className="instance-archives"><summary>{tr("实例归档 · ")}{archives.length} {tr(" 份")}</summary><p className="panel-hint">{tr("归档用于回看，不会被新任务自动复用。进行中的实例离开页面后仍可恢复。")}</p>{archives.map(entry => <div className="archive-row" key={entry.record.instanceId}><code>{entry.record.instanceId.slice(0, 8)}</code><span>{new Date(entry.archivedAt).toLocaleString(language === 'zh' ? 'zh-CN' : 'en-US')} · {entry.record.currentState} · {entry.reason}</span><button className="text-button" onClick={() => setViewingArchive(entry)}>{tr("查看记录")}</button><button className="text-button" onClick={() => downloadFile(JSON.stringify(entry, null, 2), `${machine.id}-${entry.record.instanceId}.json`, 'application/json')}>{tr("下载")}</button></div>)}</details>
    {viewingArchive && <Modal title={tr("归档实例 · 只读")} subtitle={viewingArchive.reason} onClose={() => setViewingArchive(null)} className="archive-modal">{viewingArchive.project && viewingArchive.snapshot ? <ExecutionDashboard project={viewingArchive.project} snapshot={{ ...viewingArchive.snapshot, archivedAt: viewingArchive.archivedAt, paused: true, busy: false, auto: false }} connected={false} canStep={false} onControl={() => undefined} onStep={() => undefined} onInject={() => undefined} onConnect={() => undefined} /> : <pre className="archive-record">{JSON.stringify(viewingArchive.record, null, 2)}</pre>}</Modal>}
    {previousRecord && <p className="panel-hint">{tr("上一份实例已保留，可下载备份。")}<button className="text-button" onClick={() => downloadFile(previousRecord, `${machine.id}-previous-instance.json`, 'application/json')}>{tr("下载上一份实例")}</button></p>}
    {live.connectionError && <p className="inline-error">{live.connectionError}</p>}
    {live.snapshot && <ExecutionDashboard project={project} snapshot={live.snapshot} connected={live.connected} canStep={ready} onControl={action => void control(action)} onStep={() => void apply()} onInject={() => { setInjecting(v => !v); setEventText(JSON.stringify({ type: 'agent.completed', actor: tr("自己的 Agent"), detail: tr("本次执行已完成"), context: '' }, null, 2)); }} onConnect={copyConnection} />}
    {injecting && <div className="event-injector"><Field label={tr("运行事件 JSON")}><textarea rows={7} value={eventText} onChange={e => setEventText(e.target.value)} /></Field><p className="panel-hint">{tr("支持 agent.started / agent.completed / external.waiting / external.completed / human.required / run.failed / run.timeout。完成事件可附 context 和 decision。")}</p><button className="button primary" onClick={() => void inject()}>{tr("提交事件")}</button><button className="text-button" onClick={() => setInjecting(false)}>{tr("取消注入")}</button></div>}
    <div className="runtime-columns"><div className="runtime-work">
      <div className="runtime-current"><span><i />{record.status === 'completed' ? tr("实例已结束") : tr("当前状态")}</span><h3 data-testid="runtime-current-state">{current.name}{record.phase === 'exiting' && <small>{tr("子流程已返回")}</small>}</h3><code>{record.statePath.join(' / ')}</code><p>{current.description || tr("尚未填写状态说明。")}</p></div>
      <ListProgress machine={machine} record={record} />
      <Field label={tr("本次执行证据")} hint={tr("填写实际产出、任务 ID 或外部执行结果；每次迁移后清空，下一轮重新提供。")}><textarea rows={5} value={context} onChange={e => setContext(e.target.value)} disabled={busy || record.status === 'completed' || !!live.snapshot?.archivedAt} placeholder={tr("例如：任务 job-42 已完成，结果文件可读取，质量检查通过……")} maxLength={100000} /></Field>
      {driver.type === 'agent' ? <><div className="handoff-action"><button className="button" onClick={copyHandoff}><Copy size={14} />{tr("复制 Agent 交接包")}</button><span>{tr("将交接包发送给自己的 Agent，再粘贴其结构化决策。")}</span></div><Field label={tr("Agent 决策 JSON")}><textarea className="decision-input" rows={5} value={agentDecision} onChange={e => setAgentDecision(e.target.value)} disabled={busy || record.status === 'completed' || !!live.snapshot?.archivedAt} placeholder={tr("{\"transitionId\": \"路径 ID\", \"conditionMet\": true, \"targetEntryMet\": true, \"passedQuality\": [], \"evidence\": \"实际依据\"}")} /></Field></> : <p className="panel-hint">{tr("点击后将本次证据、当前节点、候选路径及最近 10 条迁移发送给 TypeSafe。低于阈值或检查未通过时保持原状态。Key 不写入项目和导出包。")}</p>}
      {error && <div className="inline-error" role="alert">{system(error)}</div>}
      <div className="runtime-actions"><button className="button primary" disabled={!ready || live.snapshot?.busy} onClick={() => void apply()}>{busy ? <Loader2 size={15} className="spin" /> : <Play size={15} />}{busy ? tr("正在判断") : driver.type === 'jev' ? tr("Jev 判断并推进") : tr("应用 Agent 决策")}</button><button className="text-button" disabled={busy || live.snapshot?.busy} onClick={() => { downloadFile(JSON.stringify(record, null, 2) + '\n', `${machine.id}-instance.json`, 'application/json'); }}><Download size={14} />{tr("实例记录")}</button><button className="text-button" disabled={busy || live.snapshot?.busy} onClick={() => void restart()}><RotateCcw size={13} />{tr("新建实例")}</button><button className="text-button" disabled={busy || !!live.snapshot?.archivedAt} onClick={() => void archiveCurrent().catch(e => setError(e.message))}>{tr("结束并归档")}</button></div>
      {result && <div className={`decision-result ${result.status}`} role="status"><strong><ShieldCheck size={16} />{system(result.reason)}</strong>{result.confidence !== undefined && <p>{tr("置信度 ")}{(result.confidence * 100).toFixed(1)}{tr("% · 路径概率 ")}{((result.probability ?? 0) * 100).toFixed(1)}%</p>}{result.checks && <details><summary>{tr("查看条件判断（")}{result.checks.length} {tr(" 项）")}</summary>{result.checks.map(check => <div key={check.id} className="check-row"><span>{check.label}</span><b className={check.passed ? 'passed' : ''}>{(check.probability * 100).toFixed(1)}%</b></div>)}</details>}</div>}
    </div><aside className="runtime-side"><h3>{tr("当前可选路径 ")}<span>{choices.length}</span></h3>{choices.map(c => <article className="candidate-card" key={c.id}><strong>{c.control === 'item' ? tr("确认当前事项") : <>{current.name}<ArrowRight size={13} />{runtime.getState(machine, c.to).name}</>}</strong><code>{c.id}{c.loopRole ? ` · ${c.loopRole === 'continue' ? tr("继续循环") : tr("退出循环")}` : ''}</code><p>{c.condition || tr("条件尚未填写，暂不可迁移。")}</p>{c.requiredQuality.length > 0 && <small>{tr("必要质量项：")}{c.requiredQuality.join('、')}</small>}</article>)}{!choices.length && <p className="panel-hint">{record.status === 'completed' ? tr("当前实例已完成。") : tr("请先在画布中定义下一条路径。")}</p>}<h3>{tr("迁移记录 ")}<span>{record.history.length}</span></h3><div className="runtime-history">{record.history.slice(-12).reverse().map((entry, i) => <article key={`${entry.at}-${i}`}><strong>{entry.from} → {entry.to}</strong><span>{entry.adapter === 'jev' ? 'Jev' : tr("自己的 Agent")} · {entry.transitionId}</span><p>{entry.evidence}</p></article>)}{!record.history.length && <p className="panel-hint">{tr("尚未发生迁移。实例独立于状态机定义保存；修改定义后从新实例开始。")}</p>}</div></aside></div>
  </section>;
}

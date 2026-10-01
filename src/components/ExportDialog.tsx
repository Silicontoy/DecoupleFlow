import { useI18n, type Language } from '../i18n';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Check, CheckCircle2, ChevronRight, Copy, Download, FileCode2, FileJson, FileText, Folder, GitBranch, Loader2, Package, Terminal, XCircle } from 'lucide-react';
import { bundleZip, type Bundle } from '../domain/compiler';
import { compileStateDiagram } from '../domain/diagram';
import { TARGETS, driverOf, type Machine, type Target } from '../domain/types';
import { buildWorkflowBundle, WORKFLOW_TARGETS, type WorkflowTarget } from '../domain/workflowExport';
import { copyText, downloadFile, localRequest, type LocalInfo } from '../lib/files';
import { Field } from './Inspector';
import { Modal } from './Modal';
import { AgentDirectoryPicker, useAgentDirectories } from './AgentDirectoryPicker';

type Preview = { status: string; targetPath: string; message?: string; fileCount: number };
type ExportRoute = 'skill' | WorkflowTarget | 'markdown';
type WorkflowExport = { machine: Machine; language: Language; bundle?: Bundle; error?: string };

function ExportRouteTabs({ route, onChange, busy = false, actions }: { route: ExportRoute; onChange: (route: ExportRoute) => void; busy?: boolean; actions: ReactNode }) {
  const { t: tr } = useI18n();
  return <div className="export-route-tabs" role="group" aria-label={tr('导出路线')}>
    {([['skill', 'Agent Skill'], ['langgraph', 'LangChain / LangGraph'], ['dify', 'Dify'], ['markdown', 'Markdown']] as const).map(([id, label]) =>
      <button key={id} className={route === id ? 'active' : ''} aria-pressed={route === id} disabled={busy} onClick={() => onChange(id)}>{label}</button>)}
    <div className="export-route-actions">{actions}</div>
  </div>;
}

function WorkflowExportContent({ machine, target, bundle, error, activeFile, onSelect, notify }: {
  machine: Machine; target: WorkflowTarget; bundle?: Bundle; error?: string;
  activeFile: string; onSelect: (path: string) => void; notify: (message: string, error?: boolean) => void;
}) {
  const { t: tr, language, system } = useI18n();
  const driver = driverOf(machine);
  const ready = !!bundle && bundle.language === language;
  return <>
    <div className="export-content">
      <div className="export-options workflow-notes">
        <div className="export-step"><span>01</span><h3>{tr('接入方式')}</h3></div>
        <div className="workflow-target"><FileCode2 size={20} /><div><strong>{WORKFLOW_TARGETS[target].label}</strong><code>{target === 'dify' ? 'workflow.yml' : 'workflow.mjs'}</code></div></div>
        <p>{tr(WORKFLOW_TARGETS[target].summary)}</p>
        <div className="export-step"><span>02</span><h3>{tr('如何接入')}</h3></div>
        {target === 'langgraph' ? <>
          <p>{tr('解压后运行交互示例，再把自己的 Agent、LangChain Runnable 或工具绑定到节点处理器。')}</p>
          <pre className="workflow-step">npm install{'\n'}npm start</pre>
          <p>{tr('工作、等待与判断使用独立节点。支持检查点、循环和子流程返回。需要 Node.js 20+。')}</p>
          <a href="https://docs.langchain.com/oss/javascript/langgraph/graph-api" target="_blank" rel="noreferrer">{tr('LangGraph 官方文档 ↗')}</a>
        </> : <>
          <p>{tr('在 Dify 工作室选择「导入 DSL 文件」，上传 workflow.yml。')}</p>
          <div className="workflow-step">{tr('传入实例记录与本次证据')}{'\n'}{tr('→ 检查条件 / Jev 判断')}{'\n'}{tr('→ 返回下一状态及新记录')}</div>
          <p><strong>{tr('单步迁移工作流：')}</strong>{tr('每次调用最多迁移一次。循环、等待和下一节点业务由宿主继续调用；完整状态机保留在 Code 节点与总 Markdown 中。')}</p>
          <a href="https://docs.dify.ai/en/cloud/use-dify/workspace/app-management" target="_blank" rel="noreferrer">{tr('Dify 导入说明 ↗')}</a>
        </>}
        <div className="export-driver">{tr('推进方式：')}<strong>{driver.type === 'jev' ? `Jev · ${driver.model}` : tr('自己的 Agent')}</strong><br />{tr('可在「推进」页切换，导出随之更新。')}</div>
        {driver.type === 'jev' && <p>{tr('导出包不含 Key。')}{target === 'dify' ? tr('导入后在 Dify 工作流的 secret 环境变量中填写 TYPESAFE_API_KEY。') : tr('在运行环境配置 TYPESAFE_API_KEY。')}</p>}
        {error && <div className="inline-error" role="alert">{system(error)}</div>}
      </div>
      <div className="export-preview">
        <div className="preview-eyebrow"><span>{target === 'dify' ? 'DIFY WORKFLOW DSL' : 'LANGGRAPH PROJECT'}</span><span>{bundle ? tr('{0} 个文件', { 0: Object.keys(bundle.files).length }) : tr('编译中')}</span></div>
        {ready ? <FilePreview bundle={bundle} active={activeFile} onSelect={onSelect} /> : <div className="export-loading" role="status">{error ? <XCircle size={20} /> : <Loader2 className="spin" size={20} />}<p>{error ? system(error) : tr('正在生成导出包…')}</p></div>}
      </div>
    </div>
    <footer className="modal-footer">
      <span className="footer-note"><Check size={14} />{tr('保留完整定义、条件与推进配置')}</span>
      {target === 'dify' && <button className="button" disabled={!ready} onClick={() => { if (ready) downloadFile(bundle.files['workflow.yml'], `${machine.id}-dify.yml`, 'application/yaml'); }}><Download size={15} />{tr('下载 DSL')}</button>}
      <button className="button primary" disabled={!ready} onClick={() => { if (!ready) return; downloadFile(bundleZip(bundle, 'generic'), `${bundle.skillName}.zip`, 'application/zip'); notify(tr('流程接入包已导出。')); }}><Download size={16} />{tr('下载接入包')}</button>
    </footer>
  </>;
}

function MarkdownExportContent({ machine, markdown, mermaid, ready, view, onView }: {
  machine: Machine; markdown: string; mermaid: string; ready: boolean;
  view: 'markdown' | 'mermaid'; onView: (view: 'markdown' | 'mermaid') => void;
}) {
  const { t: tr } = useI18n();
  const fileName = view === 'markdown' ? `${machine.id}.md` : `${machine.id}.mermaid.md`;
  return <>
    <div className="export-content">
      <div className="export-options markdown-export-options">
        <div className="export-step"><span>01</span><h3>{tr('文档内容')}</h3></div>
        <p className="panel-hint">{tr('完整描述包含所有状态、跳转条件、质量与策略，以及整个状态机的 Mermaid 总图。')}</p>
        <div className="target-grid markdown-targets">
          <button className={`target-card ${view === 'markdown' ? 'active' : ''}`} aria-pressed={view === 'markdown'} onClick={() => onView('markdown')}><FileText size={19} /><span><strong>{tr('完整 Markdown')}</strong><small>{machine.id}.md</small></span>{view === 'markdown' && <CheckCircle2 size={15} />}</button>
          <button className={`target-card ${view === 'mermaid' ? 'active' : ''}`} aria-pressed={view === 'mermaid'} onClick={() => onView('mermaid')}><GitBranch size={19} /><span><strong>{tr('Mermaid 代码块')}</strong><small>```mermaid</small></span>{view === 'mermaid' && <CheckCircle2 size={15} />}</button>
        </div>
        <div className="export-step"><span>02</span><h3>{tr('复制与使用')}</h3></div>
        <p className="panel-hint">{tr('复制完整 Markdown，可直接交给 Agent 或保存为说明文档。')}</p>
        <p className="panel-hint">{tr('复制 Mermaid 会包含完整的 ```mermaid 代码围栏，可直接粘贴到支持 Mermaid 的 Markdown 编辑器。')}</p>
        <div className="export-driver">{tr('{0} 个状态 · {1} 条跳转', { 0: machine.states.length, 1: machine.transitions.length })}<br />{tr('循环、分支与子状态机均保留。')}</div>
      </div>
      <div className="export-preview">
        <div className="preview-eyebrow"><span>{view === 'mermaid' ? 'MERMAID' : 'MARKDOWN'}</span><span>v{machine.version}</span></div>
        <div className="code-view markdown-export-code">
          <div className="code-heading"><FileText size={14} /><span>{fileName}</span><span className="code-format">{view === 'mermaid' ? 'MERMAID' : 'MD'}</span></div>
          <pre tabIndex={0} aria-label={tr('文档源码')} aria-busy={!ready}>{ready ? view === 'mermaid' ? mermaid : markdown : tr('正在生成导出包…')}</pre>
        </div>
      </div>
    </div>
    <footer className="modal-footer">
      <span className="footer-note"><Check size={14} />{tr('完整状态机描述与 Mermaid 总图')}</span>
      <button className="button primary" disabled={!ready} onClick={() => downloadFile(markdown, `${machine.id}.md`, 'text/markdown;charset=utf-8')}><Download size={16} />{tr('下载 Markdown')}</button>
    </footer>
  </>;
}

export function FilePreview({ bundle, active, onSelect }: { bundle: Bundle; active: string; onSelect: (path: string) => void }) {
  return <div className="file-preview"><div className="file-tree"><div className="tree-root"><Folder size={15} />{bundle.skillName}</div>{Object.keys(bundle.files).map(path => <button key={path} className={`file-item ${active === path ? 'active' : ''}`} onClick={() => onSelect(path)} title={path}>{path.endsWith('.json') ? <FileJson size={14} /> : path.endsWith('.xml') ? <FileCode2 size={14} /> : <FileText size={14} />}<span>{path.split('/').at(-1)}</span></button>)}</div><div className="code-view"><div className="code-heading"><FileCode2 size={14} /><span>{active}</span><span className="code-format">{active.split('.').at(-1)?.toUpperCase()}</span></div><pre tabIndex={0}>{bundle.files[active] ?? ''}</pre></div></div>;
}
export function ExportDialog({ machine, bundle, info, onClose, notify }: { machine: Machine; bundle: Bundle; info: LocalInfo | null; onClose: () => void; notify: (message: string, error?: boolean) => void }) {
  const { t: tr, language, system } = useI18n();
  const [route, setRoute] = useState<ExportRoute>('skill');
  const [workflowExports, setWorkflowExports] = useState<Partial<Record<WorkflowTarget, WorkflowExport>>>({});
  const [workflowFiles, setWorkflowFiles] = useState<Record<WorkflowTarget, string>>({ langgraph: 'workflow.mjs', dify: 'workflow.yml' });
  const [markdownView, setMarkdownView] = useState<'markdown' | 'mermaid'>('markdown');
  const workflowTarget = route === 'langgraph' || route === 'dify' ? route : null;
  const cached = workflowTarget ? workflowExports[workflowTarget] : undefined;
  const workflow = cached?.machine === machine && cached.language === language ? cached : undefined;
  useEffect(() => {
    if (!workflowTarget || workflow) return;
    let live = true;
    void buildWorkflowBundle(machine, workflowTarget, language).then(value => {
      if (live) setWorkflowExports(previous => ({ ...previous, [workflowTarget]: { machine, language, bundle: value } }));
    }).catch(error => {
      if (live) setWorkflowExports(previous => ({ ...previous, [workflowTarget]: { machine, language, error: error.message } }));
    });
    return () => { live = false; };
  }, [machine, workflowTarget, language, workflow]);
  const markdown = bundle.files['references/state-machine.md'];
  const mermaid = useMemo(() => {
    const source = compileStateDiagram(machine, language);
    return source ? ['```mermaid', source.trimEnd(), '```', ''].join('\n') : '';
  }, [machine, language]);
  const skillReady = bundle.language === language;
  const copy = (content: string, message: string) => void copyText(content).then(() => notify(tr(message))).catch(error => notify(error.message, true));
  const [target, setTarget] = useState<Target>('codex');
  const [scope, setScope] = useState<'project' | 'personal'>('personal');
  const [root, setRoot] = useState('');
  const [userRoot, setUserRoot] = useState(info?.userHome ?? '');
  const directories = useAgentDirectories(info, userRoot);
  const [activeFile, setActiveFile] = useState('SKILL.md');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [busy, setBusy] = useState(false);
  const [installed, setInstalled] = useState<{ targetPath: string; backupPath: string | null; status: string } | null>(null);
  useEffect(() => {
    setPreview(null); setPreviewError(''); setInstalled(null);
    if (!info || target === 'generic' || route !== 'skill') return;
    if ((scope === 'project' && !root.trim()) || (scope === 'personal' && !userRoot.trim())) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void localRequest('/api/install/preview', { machine, language, target, scope, projectRoot: root, userHome: userRoot }, info, controller.signal).then(setPreview).catch(error => { if (error.name !== 'AbortError') setPreviewError(error.message); });
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [machine, target, scope, root, userRoot, info, route, language]);
  const install = async () => {
    if (!info || target === 'generic') return;
    setBusy(true);
    try {
      const result = await localRequest('/api/install', { machine, language, target, scope, projectRoot: root, userHome: userRoot }, info);
      setInstalled(result); notify(result.status === 'unchanged' ? tr("这个版本已安装，文件保持不变。") : result.status === 'updated' ? tr("Skill 已更新，旧版已备份。") : tr("Skill 已安装到目标目录。"));
    } catch (error) { notify((error as Error).message, true); }
    finally { setBusy(false); }
  };
  const destinationRoot = (scope === 'project' ? root : userRoot).trim();
  const normalizedRoot = destinationRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const selectedProject = directories.data?.projects.find(project => [project.path, project.originalPath].some(path => path.replace(/\\/g, '/').replace(/\/+$/, '') === normalizedRoot));
  const destinationName = (scope === 'project' ? selectedProject?.name : undefined) || normalizedRoot.split('/').filter(Boolean).at(-1) || destinationRoot || tr('未选择');
  const destinationPath = destinationRoot ? preview?.targetPath || `${normalizedRoot}/${scope === 'personal' ? TARGETS[target].personalDirectory : TARGETS[target].directory}/${bundle.skillName}` : tr(scope === 'project' ? '请选择项目目录' : '请选择用户主目录');
  const invocation = tr(TARGETS[target].invocation).replace('SKILL_NAME', bundle.skillName);
  const quickActions = route === 'skill' ? <div className="export-invocation">
    <span><Terminal size={14} />{tr('在 Agent 中使用')}</span>
    <code title={invocation}>{invocation}</code>
    <button className="button export-copy" onClick={() => copy(invocation, '调用方式已复制。')}><Copy size={14} />{tr('复制命令')}</button>
  </div> : route === 'langgraph' ? <div className="export-invocation">
    <span><Terminal size={14} />{tr('运行项目')}</span>
    <code title="npm install && npm start">npm install &amp;&amp; npm start</code>
    <button className="button export-copy" onClick={() => copy('npm install && npm start', '运行命令已复制。')}><Copy size={14} />{tr('复制命令')}</button>
  </div> : route === 'dify' ? <div className="export-invocation">
    <span><FileCode2 size={14} />{tr('导入 Dify')}</span>
    <code>workflow.yml</code>
    <button className="button export-copy" disabled={!workflow?.bundle} onClick={() => { if (workflow?.bundle) copy(workflow.bundle.files['workflow.yml'], 'Dify DSL 已复制。'); }}><Copy size={14} />{tr('复制 DSL')}</button>
  </div> : <div className="export-invocation export-document-actions">
    <span><FileText size={14} />{tr('一键复制')}</span>
    <button className="button export-copy" disabled={!skillReady} onClick={() => copy(markdown, 'Markdown 已复制。')}><Copy size={14} />{tr('复制 Markdown')}</button>
    <button className="button export-copy" disabled={!skillReady || !mermaid} onClick={() => copy(mermaid, 'Mermaid 代码块已复制。')}><Copy size={14} />{tr('复制 Mermaid')}</button>
  </div>;
  return <Modal title={tr('导出与接入')} subtitle={tr('从独立状态机描述，接入你选择的执行环境。')} onClose={onClose} className="export-modal">
    <ExportRouteTabs route={route} onChange={setRoute} busy={busy} actions={quickActions} />
    {route === 'skill' && <>
    <div className="export-content">
      <div className="export-options"><div className="export-step"><span>01</span><h3>{tr("选择目标 Agent")}</h3></div><div className="target-grid">{(Object.keys(TARGETS) as Target[]).map(key => <button className={`target-card ${target === key ? 'active' : ''}`} key={key} onClick={() => setTarget(key)} disabled={busy}><span className={`target-mark ${key}`}>{key === 'codex' ? '◎' : key === 'claude' ? '✳' : key === 'copilot' ? '⌘' : <Package size={19} />}</span><span>{tr(TARGETS[key].label)}</span>{target === key && <CheckCircle2 size={15} />}</button>)}</div>
        <div className="export-step"><span>02</span><h3>{tr("安装位置")}</h3></div>
        {target !== 'generic' ? <><div className="segmented"><button className={scope === 'project' ? 'active' : ''} onClick={() => setScope('project')} disabled={busy}>{tr("指定项目")}</button><button className={scope === 'personal' ? 'active' : ''} onClick={() => setScope('personal')} disabled={busy}>{tr("个人目录（默认）")}</button></div>{scope === 'project' ? <Field label={tr("项目目录")}><input value={root} onChange={e => setRoot(e.target.value)} placeholder="/path/to/project" disabled={busy} /></Field> : <Field label={tr("Agent 用户主目录")}><input value={userRoot} onChange={e => setUserRoot(e.target.value)} placeholder={tr("例如 C:\\\\Users\\\\你的用户名")} disabled={busy} /></Field>}
        {installed && <div className="installed-card"><strong><CheckCircle2 size={16} />{installed.status === 'unchanged' ? tr("已是当前版本") : tr("安装完成")}</strong><code>{installed.targetPath}</code>{installed.backupPath && <small>{tr("旧版备份：")}{installed.backupPath}</small>}</div>}
        <AgentDirectoryPicker info={info} directories={directories} busy={busy} target={target} scope={scope} userHome={userRoot} projectRoot={root} onProject={path => { setRoot(path); setScope('project'); }} onPersonal={path => { setUserRoot(path); setScope('personal'); }} />
        </> : <p className="panel-hint">{tr("下载标准 Skill 目录，可交给支持 Agent Skills 的宿主。运行助手独立工作；可按配置在执行时打开实时窗口。")}</p>}

      </div>
      <div className="export-preview"><div className="preview-eyebrow"><span>{tr('技能包')}</span><span>{Object.keys(bundle.files).length} {tr(" 个文件 · v")}{machine.version}</span></div><FilePreview bundle={bundle} active={activeFile} onSelect={setActiveFile} /></div>
    </div>
    <footer className="modal-footer skill-export-footer">
      {target !== 'generic' ? <div className="footer-note install-summary" tabIndex={0} aria-label={tr('安装位置')}>
          <p className="install-context"><strong>{tr(TARGETS[target].label)}</strong><span title={destinationRoot}>{tr(scope === 'project' ? '项目：{0}' : '个人：{0}', { 0: destinationName })}</span></p>
          <div className="install-path"><span>{tr('Skill 目录')}</span><code>{destinationPath}</code></div>
          {!info && <p className="panel-hint">{tr('离线模式 · 下载 ZIP 后安装')}</p>}

          {previewError && <div className="inline-error"><XCircle size={15} />{system(previewError)}</div>}
          {preview?.status === 'conflict' && <div className="inline-error"><XCircle size={15} />{system(preview.message ?? '')}</div>}
          {preview && preview.status !== 'conflict' && !installed && <p className="install-status"><CheckCircle2 size={14} />{preview.status === 'unchanged' ? tr("当前版本已经安装") : preview.status === 'update' ? tr("将更新技能，并备份已有版本") : tr("准备安装 {0} 个文件", { "0": preview.fileCount })}</p>}
      </div> : <span className="footer-note"><Check size={14} />{tr("描述、条件与策略完整导出")}</span>}
      <div className="export-footer-actions"><button className="button" disabled={bundle.language !== language} onClick={() => { downloadFile(bundleZip(bundle, target, scope), `${bundle.skillName}-${target}.zip`, 'application/zip'); notify(tr("Skill 安装包已导出。")); }}><Download size={16} />{tr("下载 ZIP")}</button>{target !== 'generic' && <button className="button primary" disabled={bundle.language !== language || !info || !preview || preview.status === 'conflict' || !!previewError || busy} onClick={() => void install()}>{busy ? <Loader2 size={16} className="spin" /> : <Package size={16} />}{busy ? tr("正在安装") : installed ? tr("再次检查安装") : tr("安装到 Agent")}<ChevronRight size={15} /></button>}</div>
    </footer>
    </>}
    {workflowTarget && <WorkflowExportContent machine={machine} target={workflowTarget} bundle={workflow?.bundle} error={workflow?.error} activeFile={workflowFiles[workflowTarget]} onSelect={path => setWorkflowFiles(previous => ({ ...previous, [workflowTarget]: path }))} notify={notify} />}
    {route === 'markdown' && <MarkdownExportContent machine={machine} markdown={markdown} mermaid={mermaid} ready={skillReady} view={markdownView} onView={setMarkdownView} />}
  </Modal>;
}

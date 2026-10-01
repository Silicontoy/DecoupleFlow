import { useI18n } from '../i18n';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import { DIRECTORY_AGENT_LABELS, type AgentDirectories, type DirectoryAgent } from '../domain/agentDirectories';
import type { Target } from '../domain/types';
import { localRequest, type LocalInfo } from '../lib/files';

export function useAgentDirectories(info: LocalInfo | null, userHome: string) {
  const [data, setData] = useState<AgentDirectories | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const controller = useRef<AbortController | null>(null);
  const automaticStarted = useRef(false);
  const settings = useRef({ info, userHome });
  settings.current = { info, userHome };

  const refresh = useCallback(async () => {
    const { info, userHome } = settings.current;
    if (!info || controller.current) return;
    automaticStarted.current = true;
    const request = new AbortController(); controller.current = request;
    setLoading(true); setError('');
    try {
      const result: AgentDirectories = await localRequest('/api/agents/directories', { userHome }, info, request.signal);
      if (!request.signal.aborted) setData(result);
    } catch (e) { if (!request.signal.aborted) setError((e as Error).message); }
    finally { if (controller.current === request) controller.current = null; if (!request.signal.aborted) setLoading(false); }
  }, []);

  useEffect(() => {
    if (!info || automaticStarted.current) return;
    // Defer until the effect settles so StrictMode does not start a duplicate read.
    const timer = setTimeout(() => { if (!automaticStarted.current) void refresh(); }, 0);
    return () => clearTimeout(timer);
  }, [info?.token, refresh]);
  useEffect(() => () => controller.current?.abort(), []);
  return { data, loading, error, refresh };
}

type Props = {
  info: LocalInfo | null;
  directories: ReturnType<typeof useAgentDirectories>;
  busy: boolean;
  target: Target;
  scope: 'project' | 'personal';
  userHome: string;
  projectRoot: string;
  onProject: (path: string) => void;
  onPersonal: (path: string) => void;
};

export function AgentDirectoryPicker({ info, directories, busy, target, scope, userHome, projectRoot, onProject, onPersonal }: Props) {
  const { t: tr, system } = useI18n();
  const { data, loading, error, refresh } = directories;
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | DirectoryAgent>('all');
  const disabled = busy || loading;
  const needle = query.trim().toLocaleLowerCase();
  const projects = data?.projects.filter(project => (source === 'all' || project.sources.some(s => s.agent === source)) && `${project.name} ${project.path} ${project.originalPath}`.toLocaleLowerCase().includes(needle)) ?? [];
  const profiles = (data?.profiles ?? []).filter(profile => target === 'copilot' || profile.agent === target);
  const homes = [...new Set(profiles.map(profile => profile.userHome))];
  const select = (path: string, personal = false) => { if (personal) onPersonal(path); else onProject(path); };

  return <section className="agent-directory-picker" aria-label={tr("从系统读取 Agent 目录")}>
    <div className="directory-picker-actions">
      <p className="directory-count" role="status">{loading ? tr("正在读取项目目录…") : data ? tr("已找到 {0} 个项目，{1} 个适用的个人目录", { "0": data.projects.length, "1": homes.length }) : tr("项目目录")}</p>
      <button className="icon-button" aria-label={tr("刷新项目目录")} title={tr("刷新项目目录")} disabled={!info || disabled} onClick={() => void refresh()}><RefreshCw size={14} className={loading ? 'spin' : ''} /></button>
    </div>
    {!info && <p className="directory-hint">{tr("连接本地文件服务后会自动读取项目目录，也可手动填写。")}</p>}
    {error && <p className="inline-error" role="alert">{system(error)}</p>}
    {data && <div className="directory-results" aria-busy={loading}>
      <h4>{tr("个人目录 ")}<span>{tr("供自己跨项目使用")}</span></h4>
      {homes.length ? <div className="directory-personal-list">{homes.map(home => <button key={home} className={`directory-choice ${scope === 'personal' && userHome === home ? 'selected' : ''}`} disabled={disabled} aria-label={tr("使用个人目录 {0}", { "0": home })} aria-pressed={scope === 'personal' && userHome === home} onClick={() => select(home, true)}>
        <span className="directory-choice-heading"><strong>{[...new Set(profiles.filter(profile => profile.userHome === home).map(profile => DIRECTORY_AGENT_LABELS[profile.agent]))].join(' · ')}</strong>{scope === 'personal' && userHome === home && <Check size={12} />}</span><code>{home}</code>
      </button>)}</div> : <p className="directory-empty">{tr("未识别到此 Agent 的个人目录，可在上方手动填写用户主目录。")}</p>}
      {data.notes.length > 0 && <details className="directory-notes"><summary>{tr("读取说明（")}{data.notes.length}）</summary>{data.notes.map(note => <p key={note}>{tr(note)}</p>)}</details>}
      <h4>{tr("已有项目 ")}<span>{tr("仅供选定项目使用")}</span></h4>
      <div className="directory-search"><input aria-label={tr("搜索 Agent 项目")} placeholder={tr("搜索项目名称或路径")} value={query} onChange={e => setQuery(e.target.value)} disabled={disabled} /><select aria-label={tr("项目目录来源")} value={source} onChange={e => setSource(e.target.value as typeof source)} disabled={disabled}><option value="all">{tr("全部来源")}</option><option value="codex">Codex</option><option value="claude">Claude</option></select></div>
      <div className="directory-project-list" aria-label={tr("已发现的项目目录")}>{projects.map(project => <button key={project.path} className={`directory-choice ${scope === 'project' && projectRoot === project.path ? 'selected' : ''}`} disabled={disabled || !project.available} aria-label={tr("使用项目 {0} {1}", { "0": project.name, "1": project.path })} aria-pressed={scope === 'project' && projectRoot === project.path} title={project.sources.map(s => `${tr(s.label)}: ${s.file}`).join('\n')} onClick={() => select(project.path)}>
        <span className="directory-choice-heading"><strong>{project.name}</strong>{scope === 'project' && projectRoot === project.path && <Check size={12} />}</span><code>{project.path}</code><span className="directory-choice-meta">{[...new Set(project.sources.map(s => s.agent))].map(agent => <span className={`directory-source ${agent}`} key={agent}>{DIRECTORY_AGENT_LABELS[agent]}</span>)}{!project.available && <span className="directory-unavailable">{tr(project.status)}</span>}</span>
      </button>)}{!projects.length && <p className="directory-empty">{data.projects.length ? tr("没有匹配的项目，请调整搜索或来源。") : tr("没有找到项目记录。可以在 Agent 中打开项目后刷新项目目录，或手动填写。")}</p>}</div>

    </div>}
  </section>;
}

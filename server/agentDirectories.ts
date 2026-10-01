import { open, readdir, stat, realpath } from 'node:fs/promises';
import { basename, dirname, join, sep, win32, posix } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parse as parseToml } from 'smol-toml';
import { z } from 'zod';
import { InstallError, type InstallEnvironment } from './installer';
import type { AgentDirectories, AgentProjectDirectory, DirectorySource, DirectoryAgent } from '../src/domain/agentDirectories';

const exec = promisify(execFile);
const RequestSchema = z.object({ userHome: z.string().max(2048).optional() }).strict();
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
const MAX_PROJECTS = 500;
export type DiscoveryEnvironment = { variables?: NodeJS.ProcessEnv; home?: string; windowsHome?: () => Promise<string | undefined> };

/** Translate paths from host records without trying to reverse Claude's lossy encoded directory names. */
export function agentLocalPath(raw: string, platform = process.platform, distro = process.env.WSL_DISTRO_NAME): string | null {
  let value = raw.trim();
  if (!value || value.length > 2048 || /[\u0000-\u001f]/.test(value)) return null;
  if (value.startsWith('\\\\?\\')) value = value.slice(4);
  if (platform === 'win32') {
    const mount = /^\/mnt\/([a-z])(?:\/(.*))?$/i.exec(value);
    if (mount) value = `${mount[1].toUpperCase()}:\\${(mount[2] || '').replace(/\//g, '\\')}`;
    return win32.isAbsolute(value) && !/^[/\\](?![/\\])/.test(value) ? win32.normalize(value) : null;
  }
  const drive = /^([a-z]):[\\/](.*)$/i.exec(value);
  if (drive) return posix.normalize(`/mnt/${drive[1].toLowerCase()}/${drive[2].replace(/\\/g, '/')}`);
  const wsl = /^\\\\(?:wsl\$|wsl\.localhost)\\([^\\]+)\\(.*)$/i.exec(value);
  if (wsl && distro && wsl[1].toLowerCase() === distro.toLowerCase()) return posix.normalize('/' + wsl[2].replace(/\\/g, '/'));
  return posix.isAbsolute(value) && !value.startsWith('//') ? posix.normalize(value) : null;
}
function pathKey(path: string) { return process.platform === 'win32' || /^\/mnt\/[a-z](\/|$)/i.test(path) ? path.toLowerCase() : path; }
async function windowsUserHome(variables: NodeJS.ProcessEnv) {
  if (variables.USERPROFILE) return variables.USERPROFILE;
  if (!variables.WSL_DISTRO_NAME) return undefined;
  try {
    const result = await exec('/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '[Environment]::GetFolderPath("UserProfile")'], { timeout: 2500, maxBuffer: 8192, windowsHide: true });
    return result.stdout.trim();
  } catch { return undefined; }
}
async function existsDirectory(path: string) { try { return (await stat(path)).isDirectory(); } catch { return false; } }
async function readBounded(path: string, bytes: number, tail = false): Promise<{ text: string; truncated: boolean } | null> {
  let file;
  try {
    file = await open(path, 'r'); const meta = await file.stat();
    if (!meta.isFile()) return null;
    if (meta.size > bytes && !tail) throw new Error('文件超过读取上限');
    const size = Math.min(meta.size, bytes), buffer = Buffer.alloc(size), offset = tail ? Math.max(0, meta.size - bytes) : 0;
    const { bytesRead } = await file.read(buffer, 0, size, offset);
    let text = buffer.subarray(0, bytesRead).toString('utf8').replace(/^\uFEFF/, '');
    if (offset) { const start = text.indexOf('\n'); text = start < 0 ? '' : text.slice(start + 1); }
    return { text, truncated: offset > 0 };
  } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return null; throw e; }
  finally { await file?.close(); }
}

export async function discoverAgentDirectories(raw: unknown, install: InstallEnvironment, environment: DiscoveryEnvironment = {}): Promise<AgentDirectories> {
  const input = RequestSchema.parse(raw), variables = environment.variables ?? process.env;
  const localHome = environment.home ?? homedir();
  const result: AgentDirectories = { projects: [], profiles: [], notes: [], scannedAt: new Date().toISOString() };
  const note = (message: string) => { if (!result.notes.includes(message)) result.notes.push(message); };
  const homes = new Map<string, string>();
  const addHome = (value?: string) => { if (!value) return; const path = agentLocalPath(value, process.platform, variables.WSL_DISTRO_NAME); if (path) homes.set(pathKey(path), path); };
  if (input.userHome?.trim() && !agentLocalPath(input.userHome, process.platform, variables.WSL_DISTRO_NAME)) throw new InstallError('Agent 用户主目录需要当前系统可识别的绝对路径。');
  addHome(input.userHome); addHome(install.userHome); addHome(localHome);
  addHome(await (environment.windowsHome ? environment.windowsHome() : windowsUserHome(variables)));
  for (const value of [variables.CODEX_HOME, variables.CLAUDE_CONFIG_DIR]) {
    const path = value && agentLocalPath(value, process.platform, variables.WSL_DISTRO_NAME);
    if (path && ['.codex', '.claude'].includes(basename(path))) addHome(dirname(path));
  }
  const configs = new Map<string, { agent: DirectoryAgent; path: string; userHome: string }>();
  function config(agent: DirectoryAgent, path: string, userHome: string) { configs.set(`${agent}:${pathKey(path)}`, { agent, path, userHome }); }
  for (const home of homes.values()) { config('codex', join(home, '.codex'), home); config('claude', join(home, '.claude'), home); }
  for (const [agent, variable] of [['codex', variables.CODEX_HOME], ['claude', variables.CLAUDE_CONFIG_DIR]] as const) {
    const path = variable && agentLocalPath(variable, process.platform, variables.WSL_DISTRO_NAME);
    if (path) {
      const owner = [...homes.values()].filter(home => pathKey(path).startsWith(pathKey(home).replace(/[\\/]+$/, '') + sep)).sort((a, b) => b.length - a.length)[0];
      config(agent, path, owner || agentLocalPath(install.userHome) || localHome);
    }
  }
  const candidates = new Map<string, AgentProjectDirectory>();
  const add = (rawPath: unknown, source: DirectorySource, name?: unknown, used?: unknown) => {
    if (typeof rawPath !== 'string' || !rawPath.trim() || rawPath.length > 2048 || /[\u0000-\u001f]/.test(rawPath)) return;
    const normalized = agentLocalPath(rawPath, process.platform, variables.WSL_DISTRO_NAME);
    if (!normalized && !/^[a-z]:[\\/]|^\\\\|^\//i.test(rawPath)) return;
    const path = normalized ?? rawPath, key = pathKey(path), previous = candidates.get(key);
    if (!previous && candidates.size >= MAX_PROJECTS) { note('项目记录较多，本次最多显示 500 个目录。'); return; }
    const date = typeof used === 'number' || typeof used === 'string' ? new Date(used) : null;
    const lastUsed = date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
    if (previous) {
      if (!previous.sources.some(s => s.file === source.file && s.label === source.label)) previous.sources.push(source);
      if (lastUsed && (!previous.lastUsed || lastUsed > previous.lastUsed)) previous.lastUsed = lastUsed;
      if (typeof name === 'string' && name.trim()) previous.name = name.trim().slice(0, 120);
      return;
    }
    candidates.set(key, { path, originalPath: rawPath, name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : (rawPath.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1) || rawPath), available: false, status: normalized ? '待检查' : '不属于当前系统', lastUsed, sources: [source] });
  };
  for (const entry of configs.values()) {
    const { agent, path, userHome } = entry;
    let found = await existsDirectory(path);
    const source = (file: string, label: string): DirectorySource => ({ agent, userHome, file, label });
    const jsonFile = async (file: string, label: string, apply: (data: Record<string, unknown>, source: DirectorySource) => void) => {
      try { const read = await readBounded(file, 8 * 1024 * 1024); if (!read) return; found = true; apply(object(JSON.parse(read.text)), source(file, label)); }
      catch { note(`${label}读取失败或格式不支持，已继续读取其他来源。`); }
    };
    if (agent === 'codex') {
      await jsonFile(join(path, '.codex-global-state.json'), 'Codex 工作区', (data, src) => {
        for (const value of Object.values(object(data['local-projects']))) {
          const project = object(value);
          for (const root of strings(project.rootPaths)) add(root, src, project.name, project.updatedAt);
        }
        const labels = object(data['electron-workspace-root-labels']);
        for (const root of [...strings(data['electron-saved-workspace-roots']), ...strings(data['active-workspace-roots'])]) add(root, src, labels[root]);
      });
      const file = join(path, 'config.toml');
      try {
        const read = await readBounded(file, 4 * 1024 * 1024);
        if (read) { found = true; for (const project of Object.keys(object(parseToml(read.text).projects))) add(project, source(file, 'Codex 项目配置')); }
      } catch { note('Codex 项目配置读取失败或格式不支持，已继续读取其他来源。'); }
    } else {
      // The default global config is beside .claude; a custom config root can carry .claude.json inside it.
      const globals = new Set([join(userHome, '.claude.json'), join(path, '.claude.json')]);
      for (const file of globals) await jsonFile(file, 'Claude 项目配置', (data, src) => {
        for (const [project, info] of Object.entries(object(data.projects))) add(project, src, undefined, object(info).lastUsed);
      });
      const projectRoot = join(path, 'projects');
      try {
        const folders = (await readdir(projectRoot, { withFileTypes: true })).filter(d => d.isDirectory());
        if (folders.length > 500) note('Claude 项目索引较多，本次读取前 500 个索引。');
        for (const folder of folders.slice(0, 500)) await jsonFile(join(projectRoot, folder.name, 'sessions-index.json'), 'Claude 项目索引', (data, src) => {
          add(data.originalPath, src);
          if (Array.isArray(data.entries)) for (const value of data.entries) { const item = object(value); add(item.projectPath, src, undefined, item.modified); }
        });
      } catch (e) { if (!['ENOENT', 'ENOTDIR'].includes((e as NodeJS.ErrnoException).code || '')) note('Claude 项目索引无法读取，已继续读取其他来源。'); }
      // Some Claude versions do not create sessions-index.json. Extract only project paths from the bounded recent history.
      const history = join(path, 'history.jsonl');
      try {
        const read = await readBounded(history, 4 * 1024 * 1024, true);
        if (read) {
          found = true; if (read.truncated) note('Claude 历史较大，本次从最近 4 MB 中提取项目路径。');
          for (const line of read.text.split('\n').reverse()) {
            if (!line.trim() || line.length > 512 * 1024) continue;
            try { const item = object(JSON.parse(line)); add(item.project, source(history, 'Claude 最近项目'), undefined, item.timestamp); } catch { /* A partially written history entry does not hide other projects. */ }
          }
        }
      } catch { note('Claude 最近项目无法读取，已保留其他来源的项目。'); }
    }
    if (found && await existsDirectory(userHome)) result.profiles.push({ agent, userHome, configDirectory: path });
  }
  const projects = [...candidates.values()];
  // Bound filesystem probes instead of traversing project contents.
  for (let offset = 0; offset < projects.length; offset += 24) await Promise.all(projects.slice(offset, offset + 24).map(async project => {
    if (project.status === '不属于当前系统') return;
    try { const meta = await stat(project.path); project.available = meta.isDirectory(); project.status = project.available ? '可用' : '不是目录'; if (project.available) project.path = await realpath(project.path); }
    catch (e) { project.available = false; project.status = (e as NodeJS.ErrnoException).code === 'ENOENT' ? '目录已不存在' : '目录不可访问'; }
  }));
  const merged = new Map<string, AgentProjectDirectory>();
  for (const project of projects) {
    const key = pathKey(project.path), prior = merged.get(key);
    if (!prior) merged.set(key, project);
    else { for (const src of project.sources) if (!prior.sources.some(s => s.agent === src.agent && s.file === src.file)) prior.sources.push(src); if (project.lastUsed && (!prior.lastUsed || project.lastUsed > prior.lastUsed)) prior.lastUsed = project.lastUsed; }
  }
  result.projects = [...merged.values()].sort((a, b) => Number(b.available) - Number(a.available) || (b.lastUsed || '').localeCompare(a.lastUsed || '') || a.name.localeCompare(b.name, 'zh-CN'));
  result.profiles = result.profiles.filter((profile, i, all) => all.findIndex(p => p.agent === profile.agent && pathKey(p.userHome) === pathKey(profile.userHome)) === i);
  return result;
}

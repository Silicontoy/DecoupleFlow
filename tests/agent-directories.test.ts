import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentLocalPath, discoverAgentDirectories } from '../server/agentDirectories';

let root: string, home: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'df-directories-')); home = join(root, 'home'); await mkdir(home); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function file(path: string, contents: string | object) { await mkdir(dirname(path), { recursive: true }); await writeFile(path, typeof contents === 'string' ? contents : JSON.stringify(contents)); }
async function project(name: string) { const path = join(root, name); await mkdir(path); return path; }
const discover = (userHome?: string, variables: NodeJS.ProcessEnv = {}) => discoverAgentDirectories({ userHome }, { projectRoot: '/never-default-to-this', userHome: home }, { variables, home, windowsHome: async () => undefined });

describe('local Agent directory discovery', () => {
  it('merges Codex workspaces, TOML projects and Claude metadata without returning config or prompt content', async () => {
    const shared = await project('共享项目'), configured = await project('configured project'), indexed = await project('from-index'), recent = await project('from-history');
    const globalPath = join(home, '.codex/.codex-global-state.json');
    await file(globalPath, {
      'local-projects': { one: { name: '团队项目', rootPaths: [shared], updatedAt: 1700000000000 } },
      'electron-saved-workspace-roots': [shared], 'active-workspace-roots': [shared],
      'unrelated-secret': 'NEVER_RETURN_WORKSPACE_CONTENT',
    });
    await file(join(home, '.codex/config.toml'), `api_key = 'NEVER_RETURN_KEY'\n[projects.'${configured}']\ntrust_level = 'trusted'\n[projects.${JSON.stringify(shared)}]\ntrust_level = 'trusted'\n`);
    await file(join(home, '.claude.json'), { projects: { [shared]: { allowedTools: ['NEVER_RETURN_PRIVATE_CONFIG'] } }, oauthAccount: 'NEVER_RETURN_ACCOUNT' });
    await file(join(home, '.claude/projects/encoded-name/sessions-index.json'), { originalPath: indexed, entries: [{ projectPath: shared, modified: '2026-01-01T00:00:00Z', summary: 'NEVER_RETURN_CONVERSATION' }] });
    await file(join(home, '.claude/history.jsonl'), [JSON.stringify({ project: recent, timestamp: 1800000000000, display: 'NEVER_RETURN_PROMPT', pastedContents: 'NEVER_RETURN_PASTE' }), '{partial line'].join('\n'));
    const before = await readFile(globalPath, 'utf8');
    const result = await discover();
    expect(result.projects).toHaveLength(4);
    const merged = result.projects.find(p => p.path === shared)!;
    expect(merged.name).toBe('团队项目'); expect(merged.available).toBe(true);
    expect(new Set(merged.sources.map(s => s.agent))).toEqual(new Set(['codex', 'claude']));
    expect(merged.sources.map(s => s.label)).toEqual(expect.arrayContaining(['Codex 工作区', 'Codex 项目配置', 'Claude 项目配置', 'Claude 项目索引']));
    expect(result.projects[0].path).toBe(recent);
    expect(result.profiles.map(p => p.agent)).toEqual(['codex', 'claude']);
    expect(result.notes).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('NEVER_RETURN');
    expect(await readFile(globalPath, 'utf8')).toBe(before);
    expect(await readdir(shared)).toEqual([]); expect(await readdir(home)).not.toContain('.agents');
  });

  it('reads full TOML syntax and does not guess projects from encoded Claude folder names', async () => {
    const path = await project('inline.project');
    await file(join(home, '.codex/config.toml'), `projects = { ${JSON.stringify(path)} = { trust_level = 'trusted' } }`);
    await mkdir(join(home, '.claude/projects/-tmp-ambiguous-project'), { recursive: true });
    const result = await discover();
    expect(result.projects.map(p => p.path)).toEqual([path]);
  });

  it('marks removed, non-directory and foreign WSL paths unavailable and ignores relative paths', async () => {
    const missing = join(root, 'removed'); const notDirectory = join(root, 'a-file'); await file(notDirectory, 'test');
    await file(join(home, '.codex/.codex-global-state.json'), { 'electron-saved-workspace-roots': [missing, notDirectory, 'relative/project', '\\\\wsl.localhost\\AnotherDistro\\home\\repo'] });
    const result = await discover(undefined, { WSL_DISTRO_NAME: 'CurrentDistro' });
    expect(result.projects).toHaveLength(3); expect(result.projects.every(p => !p.available)).toBe(true);
    expect(result.projects.find(p => p.path === missing)?.status).toBe('目录已不存在');
    expect(result.projects.find(p => p.path === notDirectory)?.status).toBe('不是目录');
    expect(result.projects.find(p => p.originalPath.includes('AnotherDistro'))?.status).toBe('不属于当前系统');
  });

  it('merges realpath aliases and tolerates one malformed source', async () => {
    const path = await project('real'); const alias = join(root, 'alias'); await symlink(path, alias, 'dir');
    await file(join(home, '.codex/.codex-global-state.json'), { 'electron-saved-workspace-roots': [path] });
    await file(join(home, '.codex/config.toml'), '[[[invalid');
    await file(join(home, '.claude.json'), { projects: { [alias]: {} } });
    const result = await discover();
    expect(result.projects).toHaveLength(1); expect(result.projects[0].path).toBe(path);
    expect(result.projects[0].sources).toHaveLength(2);
    expect(result.notes).toEqual([expect.stringContaining('Codex 项目配置读取失败')]);
  });

  it('supports current Windows profile, a supplied home and custom Agent config roots', async () => {
    const windowsHome = await project('windows-home'), extraHome = await project('extra-home');
    const windowsProject = await project('windows-project'), suppliedProject = await project('supplied-project'), customProject = await project('custom-project');
    await file(join(windowsHome, '.codex/.codex-global-state.json'), { 'local-projects': { id: { name: 'Windows project', rootPaths: [windowsProject] } } });
    await file(join(extraHome, '.claude.json'), { projects: { [suppliedProject]: {} } });
    const customCodex = join(home, 'config/codex'), customClaude = join(home, 'config/claude');
    await file(join(customCodex, 'config.toml'), `[projects.'${customProject}']\ntrust_level='trusted'`);
    await file(join(customClaude, '.claude.json'), { projects: { [customProject]: {} } });
    const result = await discoverAgentDirectories({ userHome: extraHome }, { projectRoot: '', userHome: home }, { home, variables: { USERPROFILE: windowsHome, CODEX_HOME: customCodex, CLAUDE_CONFIG_DIR: customClaude } });
    expect(result.projects.map(p => p.path).sort()).toEqual([windowsProject, suppliedProject, customProject].sort());
    expect(result.profiles).toEqual(expect.arrayContaining([
      { agent: 'codex', userHome: windowsHome, configDirectory: join(windowsHome, '.codex') },
      { agent: 'codex', userHome: home, configDirectory: customCodex },
      { agent: 'claude', userHome: home, configDirectory: customClaude },
      { agent: 'claude', userHome: extraHome, configDirectory: join(extraHome, '.claude') },
    ]));
  });

  it('returns a useful empty result and rejects invalid manual home inputs', async () => {
    const result = await discover(); expect(result.projects).toEqual([]); expect(result.profiles).toEqual([]);
    await expect(discover('relative')).rejects.toThrow('绝对路径');
    await expect(discoverAgentDirectories({ command: 'ignored' }, { projectRoot: '', userHome: home })).rejects.toThrow();
  });

  it('bounds large history reads to recent records and leaves the source intact', async () => {
    const old = await project('old-history'), recent = await project('recent-history');
    const contents = JSON.stringify({ project: old }) + '\n' + 'invalid\n'.repeat(600000) + JSON.stringify({ project: recent, timestamp: Date.now() }) + '\n';
    const path = join(home, '.claude/history.jsonl'); await file(path, contents);
    const result = await discover();
    expect(result.projects.map(p => p.path)).toEqual([recent]);
    expect(result.notes).toContain('Claude 历史较大，本次从最近 4 MB 中提取项目路径。');
    expect((await readFile(path, 'utf8')).length).toBe(contents.length);
  });
});

describe('Agent paths across Windows and WSL', () => {
  it('normalizes drive letters, escaped slashes, spaces and native POSIX paths', () => {
    expect(agentLocalPath('B:\\\\project\\My Repo', 'linux')).toBe('/mnt/b/project/My Repo');
    expect(agentLocalPath('C:/Users/me/project/../repo', 'linux')).toBe('/mnt/c/Users/me/repo');
    expect(agentLocalPath('\\\\?\\C:\\Users\\me', 'linux')).toBe('/mnt/c/Users/me');
    expect(agentLocalPath('/mnt/b/project/My Repo', 'win32')).toBe('B:\\project\\My Repo');
    expect(agentLocalPath('/home/user/project', 'win32')).toBeNull();
    expect(agentLocalPath('/home/user/../repo', 'linux')).toBe('/home/repo');
    expect(agentLocalPath('relative/path', 'linux')).toBeNull();
  });
  it('only converts WSL UNC records for the current distribution', () => {
    expect(agentLocalPath('\\\\wsl.localhost\\Ubuntu\\home\\me\\repo', 'linux', 'Ubuntu')).toBe('/home/me/repo');
    expect(agentLocalPath('\\\\wsl$\\Ubuntu\\home\\me\\repo', 'linux', 'ubuntu')).toBe('/home/me/repo');
    expect(agentLocalPath('\\\\wsl$\\Other\\home\\me', 'linux', 'Ubuntu')).toBeNull();
    expect(agentLocalPath('\\\\server\\share', 'linux')).toBeNull();
    expect(agentLocalPath('/tmp/invalid\u0000path', 'linux')).toBeNull();
  });
});

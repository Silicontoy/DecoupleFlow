import { webcrypto } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTemplate } from '../src/domain/templates';
import { buildSkillBundle, hashText } from '../src/domain/compiler';
import { DEFAULT_DRIVER } from '../src/domain/types';
import { installSkill, normalizeLocalPath, previewInstall, type InstallEnvironment, type InstallRequest } from '../server/installer';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
let root: string, env: InstallEnvironment, request: InstallRequest;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'decoupleflow-test-'));
  env = { projectRoot: join(root, 'project'), userHome: join(root, 'home') };
  await Promise.all([mkdir(env.projectRoot), mkdir(env.userHome)]);
  request = { machine: createTemplate().machine, target: 'codex', scope: 'project', projectRoot: env.projectRoot };
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

it('can retire an unchanged Jev CLI when switching back to own Agent, keeping a backup', async () => {
  request.machine.driver = { ...DEFAULT_DRIVER, type: 'jev' };
  const installed = await installSkill(request, env);
  expect(await readFile(join(installed.targetPath, 'scripts/adapter.mjs'), 'utf8')).toContain('requestJev');
  request.machine.driver.type = 'agent';
  const updated = await installSkill(request, env);
  expect(updated.status).toBe('updated'); expect(updated.backupPath).toBeTruthy();
  expect(await readdir(join(updated.targetPath, 'scripts'))).not.toContain('decide.mjs');
  expect(await readFile(join(updated.targetPath, 'scripts/run.mjs'), 'utf8')).toContain('runCommand');
  expect(await readFile(join(updated.backupPath!, 'scripts/adapter.mjs'), 'utf8')).toContain('requestJev');
});

it('preserves a manually modified Jev adapter when changing driver', async () => {
  request.machine.driver = { ...DEFAULT_DRIVER, type: 'jev' };
  const installed = await installSkill(request, env);
  await writeFile(join(installed.targetPath, 'scripts/adapter.mjs'), '// local changes');
  request.machine.driver.type = 'agent';
  expect((await previewInstall(request, env)).status).toBe('conflict');
  await expect(installSkill(request, env)).rejects.toThrow('被修改');
  expect(await readFile(join(installed.targetPath, 'scripts/adapter.mjs'), 'utf8')).toBe('// local changes');
});

describe('local Skill installation', () => {
  it.each([['codex', 'project', '.agents/skills'], ['claude', 'project', '.claude/skills'], ['copilot', 'project', '.github/skills'], ['copilot', 'personal', '.copilot/skills']] as const)('installs %s in %s scope with no runtime dependency', async (target, scope, relative) => {
    const input = { ...request, target, scope };
    expect((await previewInstall(input, env)).status).toBe('new');
    const result = await installSkill(input, env);
    expect(result.targetPath).toBe(join(scope === 'personal' ? env.userHome : env.projectRoot, relative, 'df-analysis-review'));
    expect(result.status).toBe('installed');
    const bundle = await buildSkillBundle(request.machine);
    for (const [path, content] of Object.entries(bundle.files)) expect(await readFile(join(result.targetPath, path), 'utf8')).toBe(content);
    expect((await installSkill(input, env)).status).toBe('unchanged');
  });

  it('backs up a previous generated version outside the discoverable skills directory', async () => {
    const first = await installSkill(request, env);
    const previous = await readFile(join(first.targetPath, 'references/state-machine.md'), 'utf8');
    request.machine.version = '1.1.0'; request.machine.states[0].description = '修订后的状态说明';
    expect((await previewInstall(request, env)).status).toBe('update');
    const update = await installSkill(request, env);
    expect(update.status).toBe('updated'); expect(update.backupPath).toBeTruthy();
    expect(update.backupPath).not.toContain(`${join('.agents', 'skills')}`);
    expect(await readFile(join(update.backupPath!, 'references/state-machine.md'), 'utf8')).toBe(previous);
    expect(await readFile(join(update.targetPath, 'references/state-machine.md'), 'utf8')).toContain('修订后的状态说明');
    expect(await readdir(join(env.projectRoot, '.agents', 'skills'))).toEqual(['df-analysis-review']);
  });

  it.each(['edited', 'extra'] as const)('preserves %s user files and refuses replacement', async mode => {
    const installed = await installSkill(request, env);
    const path = join(installed.targetPath, mode === 'edited' ? 'SKILL.md' : 'personal-notes.md');
    await writeFile(path, '用户手工内容');
    expect((await previewInstall(request, env)).status).toBe('conflict');
    await expect(installSkill(request, env)).rejects.toMatchObject({ status: 409 });
    expect(await readFile(path, 'utf8')).toBe('用户手工内容');
  });

  it('does not overwrite an unmanaged skill', async () => {
    const destination = join(env.projectRoot, '.agents/skills/df-analysis-review');
    await mkdir(destination, { recursive: true }); await writeFile(join(destination, 'SKILL.md'), 'existing');
    await expect(installSkill(request, env)).rejects.toMatchObject({ status: 409 });
    expect(await readFile(join(destination, 'SKILL.md'), 'utf8')).toBe('existing');
  });

  it('rejects traversal identifiers and relative project paths', async () => {
    await expect(installSkill({ ...request, projectRoot: '../elsewhere' }, env)).rejects.toThrow('绝对路径');
    await expect(installSkill({ ...request, machine: { ...request.machine, id: '../elsewhere' } }, env)).rejects.toThrow();
    expect(await readdir(env.projectRoot)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('rejects symlinks in installation and backup paths', async () => {
    await symlink(env.userHome, join(env.projectRoot, '.agents'));
    await expect(installSkill(request, env)).rejects.toThrow('符号链接');
    await rm(join(env.projectRoot, '.agents'));
    const installed = await installSkill(request, env);
    await symlink(env.userHome, join(env.projectRoot, '.agents', 'decoupleflow-backups'));
    request.machine.version = '2';
    await expect(installSkill(request, env)).rejects.toThrow('备份目录');
    expect(await readFile(join(installed.targetPath, 'SKILL.md'), 'utf8')).toContain('1.0.0');
    expect(await readdir(env.userHome)).toEqual([]);
  });

  it('serializes duplicate clicks without producing duplicate installs', async () => {
    const results = await Promise.all([installSkill(request, env), installSkill(request, env)]);
    expect(results.map(r => r.status)).toEqual(['installed', 'unchanged']);
  });

  it('backs up and retires a verified old timeline while updating the main state-machine Markdown', async () => {
    const installed = await installSkill(request, env);
    const manifestPath = join(installed.targetPath, 'decoupleflow-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const legacy = '# 旧版排期\n';
    manifest.files['references/gantt.md'] = await hashText(legacy); manifest.compilerVersion = '0.2.0';
    await writeFile(join(installed.targetPath, 'references/gantt.md'), legacy);
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    expect((await previewInstall(request, env)).status).toBe('update');
    const updated = await installSkill(request, env);
    expect(updated.status).toBe('updated');
    expect(await readFile(join(updated.targetPath, 'references/state-machine.md'), 'utf8')).toContain('```mermaid\nstateDiagram-v2');
    expect(await readdir(join(updated.targetPath, 'references'))).not.toContain('gantt.md');
    expect(await readFile(join(updated.backupPath!, 'references/gantt.md'), 'utf8')).toBe(legacy);
    expect(JSON.parse(await readFile(join(updated.backupPath!, 'decoupleflow-manifest.json'), 'utf8')).compilerVersion).toBe('0.2.0');
  });

  it.each(['edited', 'untracked'] as const)('preserves an %s timeline instead of retiring user content', async mode => {
    const installed = await installSkill(request, env);
    const manifestPath = join(installed.targetPath, 'decoupleflow-manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (mode === 'edited') manifest.files['references/gantt.md'] = await hashText('原生成内容');
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    const path = join(installed.targetPath, 'references/gantt.md');
    await writeFile(path, '手工保留内容');
    expect((await previewInstall(request, env)).status).toBe('conflict');
    await expect(installSkill(request, env)).rejects.toMatchObject({ status: 409 });
    expect(await readFile(path, 'utf8')).toBe('手工保留内容');
  });

  it('reports structural definition errors as invalid input', async () => {
    request.machine.initialState = 'missing';
    await expect(installSkill(request, env)).rejects.toMatchObject({ status: 400 });
    expect(await readdir(env.projectRoot)).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('accepts Windows project paths when running in WSL', () => {
    expect(normalizeLocalPath('B:\\project\\demo')).toBe('/mnt/b/project/demo');
  });
});

 it('requires an explicit project and accepts a separately chosen Agent home', async () => {
  await expect(installSkill({ ...request, projectRoot: '' }, env)).rejects.toThrow('绝对路径');
  expect(await readdir(env.projectRoot)).toEqual([]);
  const home = join(root, 'agent-home'); await mkdir(home);
  const result = await installSkill({ ...request, scope: 'personal', userHome: home }, env);
  expect(result.targetPath).toBe(join(home, '.agents/skills/df-analysis-review'));
  expect(await readdir(env.userHome)).toEqual([]);
 });

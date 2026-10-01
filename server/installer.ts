import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildSkillBundle, hashText, type Bundle } from '../src/domain/compiler';
import { MachineSchema, TARGETS, type Target } from '../src/domain/types';

export const InstallSchema = z.object({ machine: MachineSchema, language: z.enum(['en', 'zh']).default('zh'), target: z.enum(['codex', 'claude', 'copilot']), scope: z.enum(['project', 'personal']), projectRoot: z.string().max(2048).default(''), userHome: z.string().max(2048).optional() });
export type InstallRequest = Omit<z.infer<typeof InstallSchema>, 'language'> & { language?: 'en' | 'zh' };
export class InstallError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export type InstallEnvironment = { projectRoot: string; userHome: string };

async function compileRequest(request: InstallRequest) {
  try { return await buildSkillBundle(request.machine, request.language); }
  catch (error) { throw new InstallError(error instanceof Error ? error.message : '状态机定义不完整。'); }
}

export function normalizeLocalPath(input: string): string {
  const value = input.trim();
  if (process.platform !== 'win32' && /^[a-zA-Z]:[\\/]/.test(value)) return `/mnt/${value[0].toLowerCase()}/${value.slice(3).replace(/\\/g, '/')}`;
  return value;
}
async function statOrNull(path: string) {
  try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
async function resolveDestination(request: InstallRequest, env: InstallEnvironment) {
  const raw = normalizeLocalPath(request.scope === 'personal' ? request.userHome ?? env.userHome : request.projectRoot);
  if (!isAbsolute(raw)) throw new InstallError('请选择已存在的项目绝对路径。');
  let root: string;
  try { root = await realpath(raw); } catch { throw new InstallError('目标目录不存在，请先选择一个已有项目。'); }
  if (!(await lstat(root)).isDirectory()) throw new InstallError('目标路径不是文件夹。');
  const profile = TARGETS[request.target];
  const segments = (request.scope === 'personal' ? profile.personalDirectory : profile.directory).split('/');
  let skillsRoot = root;
  for (const segment of segments) {
    skillsRoot = join(skillsRoot, segment);
    const stat = await statOrNull(skillsRoot);
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new InstallError(`安装路径包含符号链接或非文件夹：${skillsRoot}`);
  }
  const skillName = `df-${request.machine.id}`;
  return { skillsRoot, targetPath: join(skillsRoot, skillName), root };
}
async function existingFiles(folder: string, prefix = ''): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(join(folder, prefix), { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new InstallError('已有技能包含符号链接，请使用其他名称或位置。', 409);
    if (entry.isDirectory()) result.push(...await existingFiles(folder, relative));
    else if (entry.isFile()) result.push(relative);
    else throw new InstallError('已有技能包含不支持的文件类型。', 409);
  }
  return result;
}
async function inspectExisting(targetPath: string, bundle: Bundle): Promise<{ status: 'new' | 'update' | 'unchanged'; previousHash?: string }> {
  const stat = await statOrNull(targetPath);
  if (!stat) return { status: 'new' };
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new InstallError('目标位置已存在其他文件或符号链接。', 409);
  let manifest: { generator: string; skillName: string; semanticHash: string; files: Record<string, string> };
  try { manifest = JSON.parse(await readFile(join(targetPath, 'decoupleflow-manifest.json'), 'utf8')); }
  catch { throw new InstallError('目标目录已有其他技能。请更换状态机标识或安装位置，现有内容未被修改。', 409); }
  if (manifest.generator !== 'DecoupleFlow' || manifest.skillName !== bundle.skillName || !manifest.files || typeof manifest.files !== 'object') throw new InstallError('目标目录不是可识别的 DecoupleFlow 技能，未执行覆盖。', 409);
  const actual = await existingFiles(targetPath);
  // Permit removal of a retired generated file only after verifying its recorded hash.
  const allowed = [...Object.keys(bundle.files).filter(path => path !== 'decoupleflow-manifest.json'), 'references/gantt.md', 'scripts/adapter.mjs', 'scripts/decide.mjs', 'scripts/run.mjs', 'scripts/monitor.mjs', 'assets/execution.html', 'references/execution.md'];
  const previousFiles = Object.keys(manifest.files);
  if (!previousFiles.length || actual.some(path => path !== 'decoupleflow-manifest.json' && (!allowed.includes(path) || !previousFiles.includes(path))) || previousFiles.some(path => !allowed.includes(path))) throw new InstallError('已有技能包含额外文件，请另存一个技能名称，避免覆盖手工修改。', 409);
  // Validate all previously generated files before adding or retiring files during an upgrade.
  for (const path of previousFiles) {
    let content: string;
    try { content = await readFile(join(targetPath, path), 'utf8'); } catch { throw new InstallError('已有技能的文件发生变化，未执行覆盖。请另存名称。', 409); }
    if (manifest.files[path] !== await hashText(content)) throw new InstallError(`已有技能的 ${path} 被修改，未执行覆盖。请另存名称或自行备份。`, 409);
  }
  const equal = await Promise.all(Object.entries(bundle.files).map(async ([path, content]) => actual.includes(path) && (await readFile(join(targetPath, path), 'utf8')) === content));
  return { status: equal.every(Boolean) && actual.length === Object.keys(bundle.files).length ? 'unchanged' : 'update', previousHash: manifest.semanticHash };
}
export async function previewInstall(raw: unknown, env: InstallEnvironment) {
  const request = InstallSchema.parse(raw);
  const bundle = await compileRequest(request);
  const destination = await resolveDestination(request, env);
  try {
    const existing = await inspectExisting(destination.targetPath, bundle);
    return { ...destination, ...existing, skillName: bundle.skillName, fileCount: Object.keys(bundle.files).length };
  } catch (error) {
    if (error instanceof InstallError && error.status === 409) return { ...destination, status: 'conflict' as const, message: error.message, skillName: bundle.skillName, fileCount: Object.keys(bundle.files).length };
    throw error;
  }
}

let installQueue: Promise<unknown> = Promise.resolve();
export function installSkill(raw: unknown, env: InstallEnvironment) {
  const operation = installQueue.then(() => installExclusive(raw, env));
  installQueue = operation.catch(() => undefined);
  return operation;
}
async function installExclusive(raw: unknown, env: InstallEnvironment) {
  const request = InstallSchema.parse(raw);
  const bundle = await compileRequest(request);
  const { skillsRoot, targetPath } = await resolveDestination(request, env);
  const existing = await inspectExisting(targetPath, bundle);
  if (existing.status === 'unchanged') return { status: 'unchanged', targetPath, skillName: bundle.skillName, fileCount: Object.keys(bundle.files).length, backupPath: null };
  await mkdir(skillsRoot, { recursive: true });
  const stage = join(dirname(skillsRoot), `.decoupleflow-stage-${randomUUID()}`);
  let backupPath: string | null = null;
  await mkdir(stage);
  try {
    for (const [relative, content] of Object.entries(bundle.files)) {
      const path = join(stage, relative);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, content, { encoding: 'utf8', flag: 'wx' });
    }
    // Recheck immediately before replacing: never silently overwrite edited files.
    const rechecked = await inspectExisting(targetPath, bundle);
    if (rechecked.status !== existing.status || rechecked.previousHash !== existing.previousHash) throw new InstallError('安装期间目标文件发生变化，请重新检查后再安装。', 409);
    if (existing.status === 'update') {
      backupPath = join(dirname(skillsRoot), 'decoupleflow-backups', bundle.skillName, `${Date.now()}-${randomUUID().slice(0, 8)}`);
      for (const folder of [join(dirname(skillsRoot), 'decoupleflow-backups'), dirname(backupPath)]) {
        const stat = await statOrNull(folder);
        if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new InstallError('备份目录包含符号链接或其他文件，已保留原技能。', 409);
      }
      await mkdir(dirname(backupPath), { recursive: true });
      await rename(targetPath, backupPath);
    }
    try { await rename(stage, targetPath); }
    catch (error) {
      if (backupPath && !(await statOrNull(targetPath))) await rename(backupPath, targetPath);
      throw error;
    }
    return { status: existing.status === 'new' ? 'installed' : 'updated', targetPath, skillName: bundle.skillName, fileCount: Object.keys(bundle.files).length, backupPath };
  } finally { await rm(stage, { recursive: true, force: true }); }
}

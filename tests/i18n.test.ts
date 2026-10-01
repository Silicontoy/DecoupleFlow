import { afterEach, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { strFromU8, unzipSync } from 'fflate';
import { buildSkillBundle, bundleZip } from '../src/domain/compiler';
import { buildWorkflowBundle } from '../src/domain/workflowExport';
import { createTemplate } from '../src/domain/templates';
import { installSkill, previewInstall } from '../server/installer';
import { translate, translateSystemMessage } from '../src/i18n/translate';
import { portableEn } from '../src/i18n/portableMessages';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const temp = async () => { const root = await mkdtemp(join(tmpdir(), 'df-language-')); roots.push(root); return root; };

describe('export language', () => {
  it('localizes all generated documents while retaining authored content, IDs and definition hashes', async () => {
    const machine = createTemplate('loop', 'en').machine;
    machine.name = '质量检查 $& {0}';
    machine.states[0].description = '保留业务原文 $& {0}';
    machine.transitions[0].condition = '原始条件 {1}';
    const saved = JSON.stringify(machine);
    const [english, chinese] = await Promise.all([buildSkillBundle(machine, 'en'), buildSkillBundle(machine, 'zh')]);
    expect(english.semanticHash).toBe(chinese.semanticHash);
    expect(english.files['references/state-machine.json']).toBe(chinese.files['references/state-machine.json']);
    expect(JSON.stringify(machine)).toBe(saved);
    expect(english.files['SKILL.md']).toContain('## On every invocation');
    expect(chinese.files['SKILL.md']).toContain('## 每次调用');
    expect(english.files['SKILL.md']).toContain(machine.name);
    expect(english.files['references/state-machine.md']).toContain('## State machine overview');
    expect(english.files['references/state-machine.md']).toContain('```mermaid\nstateDiagram-v2');
    expect(english.files['references/state-machine.md']).toContain('原始条件 {1}');
    expect(english.files['references/state-machine.md']).toContain('保留业务原文 $& {0}');
    expect(JSON.parse(english.files['decoupleflow-manifest.json']).language).toBe('en');
    const zip = unzipSync(bundleZip(english, 'claude'));
    expect(strFromU8(zip[`.claude/skills/${english.skillName}/SKILL.md`])).toBe(english.files['SKILL.md']);
  });

  it.each(['analysis', 'review', 'simple', 'loop'] as const)('creates an English %s example and English documents on every export route', async name => {
    const machine = createTemplate(name, 'en').machine;
    expect(JSON.stringify(machine)).not.toMatch(/[\u3400-\u9fff]/);
    const bundles = await Promise.all([buildSkillBundle(machine, 'en'), buildWorkflowBundle(machine, 'langgraph', 'en'), buildWorkflowBundle(machine, 'dify', 'en')]);
    for (const bundle of bundles) for (const [path, content] of Object.entries(bundle.files)) {
      if (/\.(md|xml|html)$/.test(path)) expect(content, path).not.toMatch(/[\u3400-\u9fff]/);
    }
    const dsl = JSON.parse(bundles[2].files['workflow.yml']);
    expect(dsl.workflow.graph.nodes[0].data.title).toBe('Instance and execution evidence');
  });

  it('installs the selected language and backs up a language-only update', async () => {
    const root = await temp(); const machine = createTemplate('simple', 'en').machine;
    const request = { machine, target: 'codex', scope: 'project', projectRoot: root, language: 'en' };
    const env = { projectRoot: '', userHome: root };
    const installed = await installSkill(request, env);
    const original = await readFile(join(installed.targetPath, 'SKILL.md'), 'utf8');
    expect(original).toContain('## On every invocation');
    expect((await previewInstall({ ...request, language: 'zh' }, env)).status).toBe('update');
    const updated = await installSkill({ ...request, language: 'zh' }, env);
    expect(await readFile(join(updated.targetPath, 'SKILL.md'), 'utf8')).toContain('## 每次调用');
    expect(await readFile(join(updated.backupPath!, 'SKILL.md'), 'utf8')).toBe(original);
    expect((await previewInstall({ ...request, language: 'zh' }, env)).status).toBe('unchanged');
  });

  it('ships a working English runner, localized handoff, and syntactically valid portable code', async () => {
    const root = await temp(); const skill = join(root, 'skill');
    const bundle = await buildSkillBundle(createTemplate('simple', 'en').machine, 'en');
    for (const [path, content] of Object.entries(bundle.files)) {
      await mkdir(dirname(join(skill, path)), { recursive: true }); await writeFile(join(skill, path), content);
      if (path.endsWith('.mjs')) await exec(process.execPath, ['--check', join(skill, path)]);
    }
    // Static source translations must not introduce JavaScript delimiters.
    for (const message of Object.values(portableEn)) expect(message).not.toMatch(/["'`\\]/);
    const run = async (...args: string[]) => JSON.parse((await exec(process.execPath, [join(skill, 'scripts/run.mjs'), ...args])).stdout);
    const started = await run('start', '--workspace', root, '--visualization', 'off');
    expect(started.handoff.instructions).toContain('Evaluate outgoing paths');
    expect(started.handoff.instructions).not.toMatch(/[\u3400-\u9fff]/);
    const decision = join(root, 'decision.json');
    await writeFile(decision, JSON.stringify({ transitionId: 'prepared', conditionMet: true, targetEntryMet: true, passedQuality: [], evidence: '真实证据 $&' }));
    const result = await run('advance', '--instance', started.instance, '--decision', decision);
    expect(result.record.currentState).toBe('work');
    expect(result.reason).toContain('Moved from');
    expect(result.record.history[0].evidence).toBe('真实证据 $&');
    await run('archive', '--instance', started.instance);
    await expect(run('resume', '--instance', started.instance)).rejects.toThrow('archived');
  });

  it('formats system messages without recursively translating interpolated user values', () => {
    expect(translate('en', '使用项目 {0} {1}', { 0: '项目 $& {1}', 1: '/中文目录' })).toBe('Use project 项目 $& {1} /中文目录');
    expect(translateSystemMessage('en', '已从「用户状态」进入「完成」。')).toBe('Moved from “用户状态” to “完成”.');
  });
});

import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildSkillBundle, bundleZip, compileMarkdown, compileXml, hashText } from '../src/domain/compiler';
import { createTemplate } from '../src/domain/templates';
import { clone, importProject, newState, type Target } from '../src/domain/types';
import { validateMachine } from '../src/domain/validate';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

describe('state-machine description and portable Skills', () => {
  it.each(['analysis', 'review', 'simple'] as const)('%s template has valid references, entries and reachable endings', template => {
    expect(validateMachine(createTemplate(template).machine)).toEqual([]);
  });

  it('preserves tool, wait, quality and fallback instructions in independent export formats', async () => {
    const { machine } = createTemplate();
    const waiting = machine.states.find(s => s.id === 'waiting')!;
    waiting.toolGuidance = '查询 original_id；不能重新提交';
    waiting.configuration = '间隔 42 秒\n不自动重试';
    waiting.strategies.onUncertain = '证据不足时停留并补充材料';
    const bundle = await buildSkillBundle(machine);
    for (const content of [compileMarkdown(machine), compileXml(machine), bundle.files['references/state-machine.json']]) {
      expect(content).toContain('查询 original_id；不能重新提交');
      expect(content).toContain('间隔 42 秒');
      expect(content).toContain('证据不足时停留并补充材料');
      expect(content).toContain('matching-result');
    }
    expect(bundle.files['SKILL.md']).toContain('不要把任务状态写进 Skill 安装目录');
    expect(bundle.files['SKILL.md']).not.toMatch(/https?:\/\/localhost|api\/install|API_KEY/);
    const record = JSON.parse(bundle.files['assets/state-record.template.json']);
    expect(record).toMatchObject({ currentState: 'prepare', statePath: ['prepare'], definitionHash: bundle.semanticHash, history: [] });
  });

  it('does not change a Skill when canvas positions, collapse state or array order change', async () => {
    const before = createTemplate(); const after = clone(before);
    after.layout.waiting = { x: 5000, y: -800, collapsed: true };
    after.machine.states.reverse(); after.machine.transitions.reverse();
    expect(await buildSkillBundle(before.machine)).toEqual(await buildSkillBundle(after.machine));
  });

  it('changes the definition hash when a transition condition changes', async () => {
    const { machine } = createTemplate(); const old = await buildSkillBundle(machine);
    machine.transitions[0].condition = '已取得可核实的受理回执';
    const updated = await buildSkillBundle(machine);
    expect(updated.semanticHash).not.toBe(old.semanticHash);
    const manifest = JSON.parse(updated.files['decoupleflow-manifest.json']);
    for (const [path, hash] of Object.entries(manifest.files)) expect(await hashText(updated.files[path])).toBe(hash);
  });

  it('escapes markup in XML and table delimiters in Markdown', () => {
    const { machine } = createTemplate();
    machine.states[0].name = '材料 <&> "a"';
    machine.transitions[0].condition = 'A | B\n必须核实';
    expect(compileXml(machine)).toContain('name="材料 &lt;&amp;&gt; &quot;a&quot;"');
    expect(compileMarkdown(machine)).toContain('A \\| B 必须核实');
  });

  it.each([
    ['codex', 'project', '.agents/skills'], ['claude', 'project', '.claude/skills'],
    ['copilot', 'project', '.github/skills'], ['copilot', 'personal', '.copilot/skills'], ['generic', 'project', ''],
  ] as const)('exports %s / %s as a ready-to-extract directory', async (target, scope, base) => {
    const bundle = await buildSkillBundle(createTemplate().machine);
    const zip = bundleZip(bundle, target as Target, scope);
    const files = unzipSync(zip);
    expect(Object.keys(files)).toHaveLength(Object.keys(bundle.files).length);
    const prefix = `${base ? base + '/' : ''}${bundle.skillName}/`;
    expect(strFromU8(files[prefix + 'SKILL.md'])).toMatch(/^---\nname: df-analysis-review\n/);
    for (const path of Object.keys(files)) expect(path.startsWith(prefix)).toBe(true);
    expect(zip).toEqual(bundleZip(bundle, target, scope));
  });
});

describe('structural correctness without executing the Agent', () => {
  it('rejects dangling transitions, terminal outgoing edges and invalid quality references', async () => {
    const { machine } = createTemplate();
    machine.transitions[0].to = 'missing';
    machine.transitions[1].from = 'done';
    machine.transitions[2].requiredQuality = ['missing-check'];
    expect(validateMachine(machine).map(d => d.code)).toEqual(expect.arrayContaining(['target', 'terminal-outgoing', 'quality-reference']));
    await expect(buildSkillBundle(machine)).rejects.toThrow();
  });

  it('keeps advice separate from transition requirements', () => {
    const { machine } = createTemplate();
    machine.transitions.find(t => t.id === 'approved')!.requiredQuality.push('clarity');
    expect(validateMachine(machine)).toEqual(expect.arrayContaining([expect.objectContaining({ level: 'error', code: 'quality-reference' })]));
  });

  it('validates submachine entries and blocks cross-scope edges and parent cycles', () => {
    const { machine } = createTemplate('simple');
    const parent = newState('subflow', 'group', '内部流程'); parent.description = '内部工作'; parent.initialState = 'work';
    machine.states.push(parent);
    machine.states.find(s => s.id === 'work')!.parentId = 'group';
    expect(validateMachine(machine).some(d => d.code === 'cross-scope')).toBe(true);
    parent.parentId = 'group';
    expect(validateMachine(machine).some(d => d.code === 'parent-cycle')).toBe(true);
    parent.parentId = null; parent.initialState = 'done';
    expect(validateMachine(machine).some(d => d.code === 'subflow-entry')).toBe(true);
  });

  it('allows unknown natural-language conditions as a draft, with an explicit warning', () => {
    const { machine } = createTemplate(); machine.transitions[0].condition = '';
    expect(validateMachine(machine).filter(d => d.code === 'condition')).toHaveLength(1);
    expect(validateMachine(machine).filter(d => d.level === 'error')).toHaveLength(0);
  });

  it('round-trips project layout and imports portable semantic definitions', () => {
    const project = createTemplate();
    expect(importProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
    expect(importProject(project.machine).machine).toEqual(project.machine);
    expect(Object.keys(importProject(project.machine).layout)).toHaveLength(6);
    expect(() => importProject({ ...project.machine, id: '../../outside' })).toThrow();
    expect(() => importProject({ ...project, schemaVersion: 42 })).toThrow();
    const draft = clone(project); draft.machine.id = 'Work In Progress';
    expect(importProject(draft).machine.id).toBe('Work In Progress');
    expect(validateMachine(importProject(draft).machine).some(d => d.level === 'error')).toBe(true);
  });
});

import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildSkillBundle, compileMarkdown, compileXml } from '../src/domain/compiler';
import { compileStateDiagram } from '../src/domain/diagram';
import { createTemplate } from '../src/domain/templates';
import { importProject, newState } from '../src/domain/types';
import { validateMachine } from '../src/domain/validate';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

describe('loop nodes and conditional routes', () => {
  it('supports a complete loop with three distinct incoming and outgoing decision paths', () => {
    const { machine } = createTemplate('loop');
    expect(validateMachine(machine)).toEqual([]);
    expect(machine.transitions.filter(t => t.to === 'review')).toHaveLength(3);
    expect(machine.transitions.filter(t => t.from === 'review')).toHaveLength(3);
    const diagram = compileStateDiagram(machine);
    expect(diagram).toContain('s_review --> s_repeat : passed');
    expect(diagram).toContain('s_repeat --> s_work : continue · 【继续循环】');
    expect(diagram).toContain('s_repeat --> s_done : finish · 【退出循环】');
    for (const transition of machine.transitions) expect(diagram).toContain(transition.condition);
  });

  it('round-trips loop roles and branch policies in project JSON and portable Skill formats', async () => {
    const project = createTemplate('loop');
    expect(importProject(JSON.parse(JSON.stringify(project)))).toEqual(project);
    const bundle = await buildSkillBundle(project.machine);
    const definition = JSON.parse(bundle.files['references/state-machine.json']);
    expect(definition.transitions.find((t: { id: string }) => t.id === 'continue').loopRole).toBe('continue');
    expect(definition.states.find((s: { id: string }) => s.id === 'repeat').routingPolicy).toContain('优先进入停止路径');
    expect(bundle.files['references/state-machine.md']).toBe(compileMarkdown(project.machine));
    expect(bundle.files['references/state-machine.md']).toContain('### 进入路径');
    expect(bundle.files['references/state-machine.md']).toContain('循环路径：退出循环');
    expect(compileXml(project.machine)).toContain('loopRole="continue"');
    expect(compileXml(project.machine)).toContain('<RoutingPolicy>用户明确要求停止');
    expect(bundle.files['SKILL.md']).toContain('每次从任一入路到达后');
  });

  it('reports unfinished loops as editable drafts without inventing missing paths', () => {
    const { machine } = createTemplate('simple');
    machine.states.find(s => s.id === 'work')!.kind = 'loop';
    const warnings = validateMachine(machine);
    expect(warnings.map(w => w.code)).toEqual(expect.arrayContaining(['loop-continue', 'loop-exit', 'loop-role-missing']));
    expect(warnings.filter(w => w.level === 'error')).toEqual([]);
    expect(compileStateDiagram(machine)).not.toContain('s_work --> s_work');
  });

  it('detects an unfinished return path and an exit incorrectly pointing to the same loop', async () => {
    const { machine } = createTemplate('loop');
    machine.transitions.find(t => t.id === 'continue')!.to = 'done';
    expect(validateMachine(machine).some(d => d.code === 'loop-return')).toBe(true);
    machine.transitions.find(t => t.id === 'finish')!.to = 'repeat';
    expect(validateMachine(machine).some(d => d.code === 'loop-exit-self')).toBe(true);
    await expect(buildSkillBundle(machine)).rejects.toThrow('退出循环');
    machine.transitions.find(t => t.id === 'start')!.loopRole = 'continue';
    expect(validateMachine(machine).some(d => d.code === 'loop-role')).toBe(true);
  });

  it('preserves parallel conditional routes to the same target and explicit self loops', () => {
    const { machine } = createTemplate('loop');
    machine.transitions.push({ ...machine.transitions.find(t => t.id === 'missing')!, id: 'alternate', condition: '资料已失效，需要重新补充' });
    machine.transitions.push({ ...machine.transitions.find(t => t.id === 'continue')!, id: 'retry-check', to: 'repeat', condition: '已完成本轮检查，重新核实剩余项目' });
    const source = compileStateDiagram(machine);
    expect(source.match(/s_review --> s_clarify/g)).toHaveLength(2);
    expect(source).toContain('s_repeat --> s_repeat : retry-check');
    expect(validateMachine(machine)).toEqual([]);
  });

  it('keeps existing project files compatible with optional routing metadata', () => {
    const project = createTemplate();
    const restored = importProject(JSON.parse(JSON.stringify(project)));
    expect(restored).toEqual(project);
    expect(restored.machine.states.every(s => s.routingPolicy === undefined)).toBe(true);
    expect(newState('loop', 'loop').kind).toBe('loop');
  });
});

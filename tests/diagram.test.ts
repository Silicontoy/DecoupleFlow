import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { buildSkillBundle, compileMarkdown } from '../src/domain/compiler';
import { compileStateDiagram } from '../src/domain/diagram';
import { createTemplate } from '../src/domain/templates';
import { clone, newState } from '../src/domain/types';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

describe('complete state-machine diagram in the main Markdown document', () => {
  it('retains every state and transition, including loops, fallback paths and unreachable states', () => {
    const { machine } = createTemplate();
    machine.states.push(newState('task', 'isolated', '未连接状态'));
    machine.transitions.push({ ...machine.transitions[0], id: 'keep-waiting', from: 'waiting', to: 'waiting', condition: '结果尚未返回', requiredQuality: [] });
    const source = compileStateDiagram(machine);
    for (const state of machine.states) expect(source).toContain(`as s_${state.id.replace(/-/g, '_')}`);
    for (const transition of machine.transitions) {
      expect(source).toContain(`s_${transition.from} --> s_${transition.to} : ${transition.id} · `);
      expect(source).toContain(transition.condition);
    }
    expect(source).toContain('必要质量：matching-result');
    expect(source).toContain('【返工 / 异常】');
    expect(source).toContain('s_problem --> s_prepare');
    expect(source).toContain('[*] --> s_prepare');
  });

  it('embeds one complete diagram in the downloaded and Skill Markdown, without a separate timeline', async () => {
    const { machine } = createTemplate();
    const markdown = compileMarkdown(machine);
    const bundle = await buildSkillBundle(machine);
    expect(markdown).toContain(`\`\`\`mermaid\n${compileStateDiagram(machine)}\`\`\``);
    expect(markdown.match(/```mermaid/g)).toHaveLength(1);
    expect(markdown.indexOf('## 状态机总览')).toBeLessThan(markdown.indexOf('## 状态一览'));
    expect(markdown).not.toMatch(/dateFormat|axisFormat|计划跨度|## 甘特图/);
    expect(bundle.files['references/state-machine.md']).toBe(markdown);
    expect(bundle.files['references/gantt.md']).toBeUndefined();
    expect(bundle.files['SKILL.md']).toContain('[状态机总文档](references/state-machine.md)');
  });

  it('preserves nested scopes and their entry and exit semantics', () => {
    const { machine } = createTemplate('simple');
    Object.assign(machine.states.find(s => s.id === 'work')!, { kind: 'subflow', initialState: 'inner-work' });
    machine.states.push({ ...newState('task', 'inner-work', '内部处理'), parentId: 'work' }, { ...newState('end', 'inner-done', '内部结束'), parentId: 'work' });
    machine.transitions.push({ ...machine.transitions[0], id: 'inner-completed', from: 'inner-work', to: 'inner-done' });
    const source = compileStateDiagram(machine);
    expect(source).toContain('state s_work {');
    expect(source).toContain('        [*] --> s_inner_work');
    expect(source).toContain('        s_inner_work --> s_inner_done');
    expect(source).toContain('        s_inner_done --> [*]');
    expect(source).toContain('    s_work --> s_done');
    expect(source).not.toContain('s_inner_done --> s_done');
  });

  it('keeps labels from introducing Mermaid statements or ending the Markdown fence', () => {
    const { machine } = createTemplate('simple');
    machine.states[0].name = 'end " as injected\n```\n<script> %%{init}%%';
    machine.transitions[0].condition = 'A < B: "ready";\n```\nstate injected { }';
    const source = compileStateDiagram(machine);
    expect(source).not.toContain('```');
    expect(source).not.toContain('<script>');
    expect(source).not.toContain('%%{');
    expect(source).not.toContain('\nstate injected');
    expect(source).toContain('#34;');
  });

  it('does not turn node actions or legacy timing settings into graph structure', () => {
    const { machine } = createTemplate();
    const after = clone(machine);
    after.states.reverse(); after.transitions.reverse();
    after.states[0].description = '等待20秒再执行三个动作';
    after.planning = { startAt: '2026-10-01T09:00', defaultDuration: { value: 4, unit: 'd' }, includeFallback: false, tasks: { problem: { included: false }, waiting: { duration: { value: 20, unit: 's' } } } };
    expect(compileStateDiagram(after)).toBe(compileStateDiagram(machine));
  });

  it('preserves an incomplete draft description and marks an unset transition condition', () => {
    const { machine } = createTemplate('simple');
    machine.transitions[0].condition = '';
    expect(compileStateDiagram(machine)).toContain('prepared · 条件待补充');
    machine.transitions[0].to = 'missing';
    const markdown = compileMarkdown(machine);
    expect(markdown).toContain('状态机结构尚未完整');
    expect(markdown).toContain('明确目标，确认当前材料。');
    expect(markdown).not.toContain('```mermaid');
  });
});

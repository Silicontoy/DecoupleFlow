import { translator, type Language } from '../i18n/translate';
import { KIND_LABELS, LOOP_ROLE_LABELS, semanticMachine, type Machine } from './types';
import { validateMachine } from './validate';

// Stable aliases avoid Mermaid keywords and punctuation in user-provided IDs.
const alias = (id: string) => `s_${id.replace(/-/g, '_')}`;
const label = (text: string) => text.replace(/\s+/g, ' ').trim().replace(/["&<>#`\\;:%{}]/g, char => `#${char.charCodeAt(0)};`);

/** Describe the complete definition, including unreachable states, loops and fallback paths. */
export function compileStateDiagram(input: Machine, language: Language = 'zh'): string {
  const tr = translator(language);
  const machine = semanticMachine(input);
  const structuralCodes = new Set(['duplicate-state', 'parent', 'parent-cycle', 'subflow-entry', 'initial', 'target', 'cross-scope', 'terminal-outgoing']);
  if (validateMachine(machine).some(d => d.level === 'error' && structuralCodes.has(d.code))) return '';
  if (!machine.states.length) return '';

  const states = new Map(machine.states.map(state => [state.id, state]));
  const lines = ['stateDiagram-v2', '    direction TB'];
  const scope = (parentId: string | null, initial: string, indent: string) => {
    for (const state of machine.states.filter(state => state.parentId === parentId)) {
      lines.push(`${indent}state "${label(state.name || state.id)}（${tr(KIND_LABELS[state.kind])}）" as ${alias(state.id)}`);
      if (state.kind === 'subflow') {
        lines.push(`${indent}state ${alias(state.id)} {`);
        scope(state.id, state.initialState, indent + '    ');
        lines.push(`${indent}}`);
      }
    }
    lines.push(`${indent}[*] --> ${alias(initial)}`);
    for (const transition of machine.transitions.filter(t => states.get(t.from)?.parentId === parentId)) {
      const condition = transition.condition.trim() || tr("条件待补充");
      const quality = transition.requiredQuality.length ? tr("；必要质量：{0}", { "0": transition.requiredQuality.join('、') }) : '';
      const kind = `${transition.loopRole ? `【${tr(LOOP_ROLE_LABELS[transition.loopRole])}】` : ''}${transition.kind === 'fallback' ? tr("【返工 / 异常】") : ''}`;
      lines.push(`${indent}${alias(transition.from)} --> ${alias(transition.to)} : ${label(`${transition.id} · ${kind}${condition}${quality}`)}`);
    }
    for (const state of machine.states.filter(state => state.parentId === parentId && state.kind === 'end')) {
      lines.push(`${indent}${alias(state.id)} --> [*]`);
    }
  };
  scope(null, machine.initialState, '    ');
  return lines.join('\n') + '\n';
}

export function compileDiagramSection(machine: Machine, language: Language = 'zh'): string {
  const tr = translator(language);
  const source = compileStateDiagram(machine, language);
  return [tr("## 状态机总览"), '', source
    ? [tr("以下为完整状态机定义。连线标注迁移 ID、跳转条件及必要质量项；返工、异常和循环均保留。子状态机内部结束后返回父层级。"), '', '```mermaid', source.trimEnd(), '```'].join('\n')
    : tr("状态机结构尚未完整。请先修正入口、节点引用或层级问题；当前定义仍列于下方。"), ''].join('\n');
}

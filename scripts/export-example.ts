import { mkdir, writeFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTemplate } from '../src/domain/templates';
import { buildSkillBundle, bundleZip, compileMarkdown } from '../src/domain/compiler';
import { DEFAULT_DRIVER, newState, type Project } from '../src/domain/types';
import { buildWorkflowBundle } from '../src/domain/workflowExport';
import { exportDemos } from './export-demos';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../examples');
const project = createTemplate();
const bundle = await buildSkillBundle(project.machine);
await mkdir(root, { recursive: true });
await writeFile(resolve(root, 'analysis-review.decoupleflow.json'), JSON.stringify(project, null, 2) + '\n');
await writeFile(resolve(root, 'analysis-review.md'), compileMarkdown(project.machine));
for (const [relative, content] of Object.entries(bundle.files)) {
  const path = resolve(root, bundle.skillName, relative);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
await writeFile(resolve(root, 'df-analysis-review-codex.zip'), bundleZip(bundle, 'codex'));
const example: Project = {
  format: 'decoupleflow-project', schemaVersion: 1,
  machine: {
    schemaVersion: 1, id: 'wait20s-example', name: '等待20秒', version: '1.0.0', purpose: '开始后等待20秒，再打印测试结果并结束。', initialState: 'start',
    states: [
      { ...newState('task', 'start', '开始'), description: '开始本次测试。' },
      { ...newState('wait', 'wait', '等待'), description: '等待20秒', strategies: { during: '使用宿主能力实际等待。', onFailure: '记录未完成的原因。', onUncertain: '核实实际等待时间。' } },
      { ...newState('task', 'print', '打印成功'), description: '打印“成功进行了skill测试”。' },
      { ...newState('end', 'done', '结束'), description: '结束当前测试。' },
    ],
    transitions: [
      { id: 'begin', from: 'start', to: 'wait', condition: '开始', kind: 'normal', requiredQuality: [], onUncertain: '确认用户是否已发起测试。' },
      { id: 'elapsed', from: 'wait', to: 'print', condition: '已实际等待至少20秒', kind: 'normal', requiredQuality: [], onUncertain: '继续等待并核实时间。' },
      { id: 'finish', from: 'print', to: 'done', condition: '成功消息已输出', kind: 'normal', requiredQuality: [], onUncertain: '确认输出结果。' },
    ],
  },
  layout: { start: { x: 30, y: 70 }, wait: { x: 370, y: 70 }, print: { x: 710, y: 70 }, done: { x: 1050, y: 70 } },
};
await writeFile(resolve(root, 'wait20s.decoupleflow.json'), JSON.stringify(example, null, 2) + '\n');
await writeFile(resolve(root, 'wait20s.md'), compileMarkdown(example.machine));
const looping = createTemplate('loop');
await writeFile(resolve(root, 'loop-and-routing.decoupleflow.json'), JSON.stringify(looping, null, 2) + '\n');
await writeFile(resolve(root, 'loop-and-routing.md'), compileMarkdown(looping.machine));
const loopingBundle = await buildSkillBundle(looping.machine);
await writeFile(resolve(root, 'df-loop-and-routing-codex.zip'), bundleZip(loopingBundle, 'codex'));
for (const target of ['langgraph', 'dify'] as const) {
  const workflow = await buildWorkflowBundle(looping.machine, target);
  for (const [relative, content] of Object.entries(workflow.files)) {
    const path = resolve(root, workflow.skillName, relative);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path, content);
  }
  await writeFile(resolve(root, `${workflow.skillName}.zip`), bundleZip(workflow, 'generic'));
}
const jevProject = structuredClone(looping);
jevProject.machine.id = 'jev-loop-and-routing'; jevProject.machine.name = 'Jev · 循环与条件分支';
jevProject.machine.driver = { ...DEFAULT_DRIVER, type: 'jev' };
await writeFile(resolve(root, 'jev-loop-and-routing.decoupleflow.json'), JSON.stringify(jevProject, null, 2) + '\n');
const jevSkill = await buildSkillBundle(jevProject.machine);
await writeFile(resolve(root, 'df-jev-loop-and-routing-codex.zip'), bundleZip(jevSkill, 'codex'));
const jevDify = await buildWorkflowBundle(jevProject.machine, 'dify');
await writeFile(resolve(root, 'jev-loop-and-routing-dify.yml'), jevDify.files['workflow.yml']);
console.log(`示例已生成：${root}`);
await exportDemos();

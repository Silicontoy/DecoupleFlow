import { test, expect, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { webcrypto } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listFixture } from '../list-fixture';
import { createTemplate } from '../../src/domain/templates';
import { runtime, type RunRecord } from '../../src/domain/runtime';
import { answer } from '../adapter-fixtures';
import { buildSkillBundle } from '../../src/domain/compiler';
if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

async function instance(page: Page): Promise<RunRecord> {
  return page.evaluate(() => { const w = JSON.parse(localStorage.getItem('decoupleflow.workspace.v1')!); return JSON.parse(localStorage.getItem(`decoupleflow.instance.${w.active}`)!); });
}

test('creates, reorders and persists list items with a shared condition and exports them in both languages', async ({ page }, info) => {
  await page.goto('/');
  await page.locator('.state-palette').getByRole('button', { name: '列表', exact: true }).click();
  await page.getByLabel('状态名称', { exact: true }).fill('Checklist demo');
  await page.getByLabel('状态说明', { exact: true }).fill('Prepare the release.');
  for (const [index, text] of ['Verify data', 'Review copy', 'Check links'].entries()) {
    await page.getByRole('button', { name: '添加事项', exact: true }).click();
    await page.getByLabel(`事项 ${index + 1}`, { exact: true }).fill(text);
  }
  await page.getByLabel('统一通过条件', { exact: true }).fill('Verified against the source.');
  await page.getByRole('button', { name: '下移事项 1', exact: true }).click();
  await expect(page.getByLabel('事项 1', { exact: true })).toHaveValue('Review copy');
  await page.getByRole('button', { name: '上移事项 2', exact: true }).click();
  await page.getByRole('button', { name: '添加事项', exact: true }).click();
  await page.getByRole('button', { name: '删除事项 4', exact: true }).click();
  await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  const saved = JSON.parse(await readFile((await (await download).path())!, 'utf8'));
  const state = saved.machine.states.find((s: { kind: string }) => s.kind === 'list');
  expect(state.list.items.map((item: { text: string }) => item.text)).toEqual(['Verify data', 'Review copy', 'Check links']);
  await page.reload();
  await page.locator('.state-outline').getByRole('button', { name: 'Checklist demo', exact: true }).click();
  await expect(page.getByLabel('统一通过条件', { exact: true })).toHaveValue('Verified against the source.');
  await expect(page.getByTestId(`state-${state.id}`)).toContainText('共 3 项');
  await page.screenshot({ path: info.outputPath('list-editor.png'), fullPage: true });
  await page.getByRole('button', { name: '描述预览', exact: true }).click();
  await page.locator('.preview-toolbar').getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(page.locator('.source-document')).toContainText('### 统一通过条件');
  await expect(page.locator('.source-document')).toContainText('全部事项通过后才检查出口条件');
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await expect(page.locator('.source-document')).toContainText('### Shared pass condition');
  await expect(page.locator('.source-document')).toContainText('Check exit conditions only after all items pass.');
  await page.getByRole('button', { name: 'Export / Connect', exact: true }).click();
  await expect(page.getByRole('dialog').locator('.code-view')).toContainText('handoff.listProgress');
});

test('advances one list item at a time, resumes the current item and opens the exit only after all pass', async ({ page }, info) => {
  const { machine, ...rest } = listFixture();
  await page.goto('/');
  await page.getByLabel('选择项目文件').setInputFiles({ name: 'list.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ machine, ...rest })) });
  await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '推进', exact: true }).click();
  await expect(page.getByText('实时连接', { exact: true })).toBeVisible();
  const progress = page.locator('.runtime-work .list-progress');
  await expect(progress).toContainText('已通过 0/3 项');
  for (let index = 0; index < 3; index++) {
    const record = await instance(page);
    const id = runtime.candidates(machine, record)[0].id;
    await expect(progress.locator('[aria-current="step"]')).toContainText(machine.states[0].list!.items[index].text);
    if (index === 0) {
      await page.getByLabel('Agent 决策 JSON').fill(JSON.stringify(answer(machine, record, 'exit')));
      await page.getByRole('button', { name: '应用 Agent 决策', exact: true }).click();
      await expect(page.locator('.decision-result.held')).toBeVisible();
      await expect(progress).toContainText('已通过 0/3 项');
    }
    await page.getByLabel('Agent 决策 JSON').fill(JSON.stringify(answer(machine, record, id)));
    await page.getByRole('button', { name: '应用 Agent 决策', exact: true }).click();
    await expect(progress).toContainText(`已通过 ${index + 1}/3 项`);
    await expect(page.getByTestId('runtime-current-state')).toHaveText('Release checklist');
    if (index === 0) {
      await page.reload(); await page.getByRole('button', { name: '推进', exact: true }).click();
      await expect(page.getByText('实时连接', { exact: true })).toBeVisible();
      await expect(progress).toContainText('已通过 1/3 项');
    }
  }
  await expect(progress).toContainText('全部事项已通过，等待出口条件');
  await expect(page.locator('.runtime-side')).toContainText('The full report is approved.');
  await expect(page.locator('.event-log .list-item-passed')).toHaveCount(3);
  await page.screenshot({ path: info.outputPath('list-progress.png'), fullPage: true });
  const record = await instance(page);
  await page.getByLabel('Agent 决策 JSON').fill(JSON.stringify(answer(machine, record, 'exit')));
  await page.getByRole('button', { name: '应用 Agent 决策', exact: true }).click();
  await expect(page.getByTestId('runtime-current-state')).toHaveText(machine.states.find(s => s.id === 'done')!.name);
});

test('retains connected ports throughout a drag across the old switching threshold and after reload', async ({ page }) => {
  await page.goto('/');
  const project = createTemplate('simple');
  await page.getByLabel('选择项目文件').setInputFiles({ name: 'simple.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  const node = page.getByTestId('state-work');
  const edge = page.locator('.react-flow__edge[data-id="prepared"] .react-flow__edge-path');
  await expect(edge).toHaveAttribute('data-source-handle', 'out');
  await expect(edge).toHaveAttribute('data-target-handle', 'in');
  await page.waitForTimeout(400);
  const before = (await node.boundingBox())!;
  const scale = before.width / 242;
  await page.mouse.move(before.x + 70, before.y + 40); await page.mouse.down();
  for (const distance of [140, 180, 220, 165, 190, 250]) {
    await page.mouse.move(before.x + 70, before.y + 40 + distance * scale, { steps: 4 });
    await expect(edge).toHaveAttribute('data-source-handle', 'out');
    await expect(edge).toHaveAttribute('data-target-handle', 'in');
  }
  await page.mouse.up();
  expect((await node.boundingBox())!.y - before.y).toBeGreaterThan(170 * scale);
  const handle = await page.locator('.react-flow__node[data-id="work"] .react-flow__handle[data-handleid="in"]').boundingBox();
  const endpoint = await edge.evaluate(element => { const path = element as SVGPathElement; const point = path.getPointAtLength(path.getTotalLength()); const screen = point.matrixTransform(path.getScreenCTM()!); return { x: screen.x, y: screen.y }; });
  expect(Math.abs(endpoint.x - handle!.x - handle!.width / 2)).toBeLessThan(4);
  expect(Math.abs(endpoint.y - handle!.y - handle!.height / 2)).toBeLessThan(4);
  await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible();
  await page.reload();
  await expect(edge).toHaveAttribute('data-source-handle', 'out');
  await expect(edge).toHaveAttribute('data-target-handle', 'in');
  await page.getByRole('button', { name: '描述预览', exact: true }).click();
  await page.getByRole('button', { name: '状态机', exact: true }).click();
  await expect(edge).toHaveAttribute('data-target-handle', 'in');
});

test('the exported Skill live window shows the actual current item and shared condition', async ({ page }, info) => {
  const root = await mkdtemp(join(tmpdir(), 'df-list-window-')); let pid = 0;
  try {
    const { machine } = listFixture(); const bundle = await buildSkillBundle(machine, 'en');
    for (const [path, content] of Object.entries(bundle.files)) { const target = join(root, 'skill', path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, content); }
    const run = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, [join(root, 'skill/scripts/run.mjs'), ...args], { timeout: 10000 })).stdout);
    const opened = await run('start', '--workspace', root, '--no-open');
    pid = JSON.parse(await readFile(join(opened.instance, 'monitor.json'), 'utf8')).pid;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(opened.viewerUrl);
    await expect(page.locator('#list-progress')).toContainText('List progress 0/3');
    await expect(page.locator('#list-progress')).toContainText(machine.states[0].list!.passCondition);
    let record = opened.record;
    for (let index = 0; index < 3; index++) {
      await expect(page.locator('#list-progress [aria-current="step"]')).toContainText(machine.states[0].list!.items[index].text);
      await writeFile(join(root, 'decision.json'), JSON.stringify(answer(machine, record, runtime.candidates(machine, record)[0].id)));
      record = (await run('advance', '--instance', opened.instance, '--decision', join(root, 'decision.json'))).record;
      await expect(page.locator('#list-progress')).toContainText(`List progress ${index + 1}/3`);
      if (index === 0) await page.screenshot({ path: info.outputPath('skill-list-progress.png'), fullPage: true });
    }
    await expect(page.locator('#list-progress')).toContainText('All items passed. Waiting for the exit condition.');
    expect(errors).toEqual([]);
    await run('archive', '--instance', opened.instance);
  } finally { if (pid) { try { process.kill(pid); } catch {} } await rm(root, { recursive: true, force: true }); }
});

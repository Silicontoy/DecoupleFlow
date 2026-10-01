import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { createTemplate } from '../../src/domain/templates';
import { newState } from '../../src/domain/types';

test('renders the whole definition in the main Markdown and exports that same document in the Skill', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: '描述预览', exact: true }).click();
  const diagram = page.getByTestId('state-diagram');
  await expect(diagram.locator('svg')).toBeVisible();
  for (const state of createTemplate().machine.states) await expect(diagram).toContainText(state.name);
  await expect(diagram).toContainText('问题已修正，重新发起');
  await expect(diagram).toContainText('外部任务明确失败');
  await expect(diagram).toContainText('必要质量：matching-result');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const source = page.locator('.source-document');
  await expect(source).toContainText('```mermaid\nstateDiagram-v2');
  await expect(source).toContainText('s_problem --> s_prepare');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载', exact: true }).click();
  const downloaded = await event;
  const markdown = await readFile((await downloaded.path())!, 'utf8');
  expect(markdown).toBe(await source.innerText());
  expect(markdown).not.toContain('dateFormat');
  await page.getByRole('button', { name: 'Skill 文件', exact: true }).click();
  await page.getByRole('button', { name: 'state-machine.md', exact: true }).click();
  expect(await page.locator('.code-view pre').innerText()).toBe(markdown);
  await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
  const zipEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载 ZIP', exact: true }).click();
  const zip = await zipEvent;
  const files = unzipSync(await readFile((await zip.path())!));
  expect(strFromU8(files['.agents/skills/df-analysis-review/references/state-machine.md'])).toBe(markdown);
  expect(Object.keys(files).some(path => path.endsWith('/scripts/run.mjs'))).toBe(true);
  expect(Object.keys(files).some(path => path.endsWith('/gantt.md'))).toBe(false);
  expect(errors).toEqual([]);
});

test('renders nested states, all loops and special label characters without adding unintended nodes', async ({ page }) => {
  const project = createTemplate('simple');
  const group = project.machine.states[1]; group.kind = 'subflow'; group.initialState = 'inner-work';
  project.machine.states[0].name = '材料 "A" < B: 50%; `笔记`';
  project.machine.states.push(
    { ...newState('task', 'inner-work', '内部处理'), parentId: 'work', description: '处理内部任务' },
    { ...newState('end', 'inner-done', '内部结束'), parentId: 'work', description: '返回父层' },
    { ...newState('task', 'isolated', '未连接状态'), description: '保持在总览中' },
  );
  project.machine.transitions.push(
    { ...project.machine.transitions[0], id: 'inner-complete', from: 'inner-work', to: 'inner-done' },
    { ...project.machine.transitions[0], id: 'internal-retry', from: 'inner-work', to: 'inner-work', condition: 'A < B: "待核实";\n```\n<script> %%{init}%%', kind: 'fallback' },
  );
  await page.goto('/');
  await page.getByLabel('选择项目文件').setInputFiles({ name: 'nested.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.getByRole('button', { name: '描述预览', exact: true }).click();
  const diagram = page.getByTestId('state-diagram');
  await expect(diagram.locator('svg')).toBeVisible();
  for (const state of project.machine.states) await expect(diagram).toContainText(state.name);
  await expect(diagram).toContainText('internal-retry');
  await expect(diagram.locator('script')).toHaveCount(0);
  await expect(diagram).toHaveClass(/ready/);
});

test('regenerates the complete diagram when a transition is edited', async ({ page }) => {
  await page.goto('/');
  await page.locator('.transition-label').filter({ hasText: '请求已受理' }).click();
  await page.getByLabel('跳转条件', { exact: true }).fill('用户确认后进入等待');
  await page.getByRole('button', { name: '描述预览', exact: true }).click();
  await expect(page.getByTestId('state-diagram')).toContainText('用户确认后进入等待');
  await expect(page.getByTestId('state-diagram')).toContainText('问题已修正，重新发起');
});

test('keeps a full state diagram scrollable within the Markdown on a narrow screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: '描述预览', exact: true }).click();
  await expect(page.getByTestId('state-diagram').locator('svg')).toBeVisible();
  await expect(page.getByRole('button', { name: '下载', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

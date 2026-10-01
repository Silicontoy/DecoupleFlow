import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createTemplate } from '../../src/domain/templates';
import type { Project } from '../../src/domain/types';

async function savedProject(page: Page): Promise<Project> {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  const file = await event;
  return JSON.parse(await readFile((await file.path())!, 'utf8'));
}

test('adds a loop node with editable incoming, continue, exit and return paths, then persists and exports it', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const project = createTemplate('simple'); project.machine.transitions = [];
  await page.goto('/');
  await page.getByLabel('选择项目文件').setInputFiles({ name: 'loop.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await page.locator('.state-palette').getByRole('button', { name: '循环', exact: true }).click();
  await page.getByRole('button', { name: '状态说明', exact: true }).click();
  await page.getByLabel('状态名称', { exact: true }).fill('重复检查');
  await page.getByLabel('状态说明', { exact: true }).fill('每轮检查是否还有待处理项目。');
  await page.getByRole('button', { name: '条件与跳转', exact: true }).click();
  await page.getByRole('button', { name: '添加入路', exact: true }).click();
  await page.getByLabel('入路 1 来源', { exact: true }).selectOption('prepare');
  await page.getByLabel('入路 1 条件', { exact: true }).fill('开始本轮工作');
  await page.getByRole('button', { name: '添加入路', exact: true }).click();
  await page.getByLabel('入路 2 来源', { exact: true }).selectOption('work');
  await page.getByLabel('入路 2 条件', { exact: true }).fill('本轮工作完成');
  await page.getByRole('button', { name: '继续循环', exact: true }).click();
  await page.getByLabel('出路 1 条件', { exact: true }).fill('仍有待处理项');
  await page.getByLabel('出路 1 目标', { exact: true }).selectOption('work');
  await page.getByRole('button', { name: '退出循环', exact: true }).click();
  await page.getByLabel('出路 2 条件', { exact: true }).fill('所有项目均已完成');
  await page.getByLabel('出路 2 目标', { exact: true }).selectOption('done');
  const policy = '只有已核实的条件可以选路；没有匹配时等待补充。';
  await page.getByLabel('分支选择策略', { exact: true }).fill(policy);
  await expect(page.locator('.state-card.kind-loop')).toContainText('2 条入路');
  await expect(page.locator('.state-card.kind-loop')).toContainText('2 条条件出路');
  await expect(page.locator('.state-card.kind-loop [data-handleid^="route-in-"]')).toHaveCount(2);
  await expect(page.locator('.state-card.kind-loop [data-handleid^="route-out-"]')).toHaveCount(2);
  await page.getByRole('button', { name: '删除出路 1', exact: true }).click();
  await expect(page.locator('.state-card.kind-loop [data-handleid^="route-out-"]')).toHaveCount(1);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.locator('.state-card.kind-loop [data-handleid^="route-out-"]')).toHaveCount(2);
  const saved = await savedProject(page);
  const loop = saved.machine.states.find(s => s.kind === 'loop')!;
  expect(loop.routingPolicy).toBe(policy);
  expect(saved.machine.transitions.filter(t => t.from === loop.id)).toEqual(expect.arrayContaining([
    expect.objectContaining({ loopRole: 'continue', to: 'work', condition: '仍有待处理项' }),
    expect.objectContaining({ loopRole: 'exit', to: 'done', condition: '所有项目均已完成' }),
  ]));
  await expect(page.getByText('已保存在本机')).toBeVisible();
  await page.reload();
  await page.locator('.state-outline').getByRole('button', { name: '重复检查', exact: true }).click();
  await expect(page.getByLabel('分支选择策略', { exact: true })).toHaveValue(policy);
  await page.getByRole('button', { name: '描述预览', exact: true }).click();
  await expect(page.getByTestId('state-diagram')).toHaveClass(/ready/);
  await expect(page.getByTestId('state-diagram')).toContainText('继续循环');
  await expect(page.getByTestId('state-diagram')).toContainText('退出循环');
  await page.getByRole('button', { name: 'Skill 文件', exact: true }).click();
  await page.getByRole('button', { name: 'state-machine.json', exact: true }).click();
  const definition = JSON.parse(await page.locator('.code-view pre').innerText());
  expect(definition.transitions.filter((t: { from: string }) => t.from === loop.id)).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('edits multiple decision inputs and conditions, including different conditions leading to the same target', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建状态机' }).click();
  await page.getByRole('button', { name: /循环与条件分支/ }).click();
  await page.locator('.state-outline').getByRole('button', { name: '判断当前结果', exact: true }).click();
  await expect(page.getByLabel('入路 3 条件', { exact: true })).toBeVisible();
  await expect(page.getByLabel('出路 3 目标', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加入路', exact: true }).click();
  await page.getByLabel('入路 4 来源', { exact: true }).selectOption('prepare');
  await page.getByLabel('入路 4 条件', { exact: true }).fill('已有结果，直接判断');
  await page.getByRole('button', { name: '添加出路', exact: true }).click();
  await page.getByLabel('出路 4 条件', { exact: true }).fill('资料已失效，重新补充');
  await page.getByLabel('出路 4 目标', { exact: true }).selectOption('clarify');
  await expect(page.getByTestId('state-review')).toContainText('4 条入路');
  await expect(page.getByTestId('state-review')).toContainText('4 条条件出路');
  await expect(page.getByTestId('state-review').locator('[data-handleid^="route-out-"]')).toHaveCount(4);
  const saved = await savedProject(page);
  expect(saved.machine.transitions.filter(t => t.from === 'review' && t.to === 'clarify')).toHaveLength(2);
  await page.getByRole('button', { name: '描述预览', exact: true }).click();
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const text = await page.locator('.source-document').innerText();
  expect(text).toContain('资料已失效，重新补充');
  expect(text).toContain('已有结果，直接判断');
  expect(text.match(/s_review --> s_clarify/g)).toHaveLength(2);
});

test('reconnects an individual decision output while preserving its condition and identity', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '切换属性面板', exact: true }).click();
  await page.waitForTimeout(400);
  const source = page.getByTestId('state-review').locator('[data-handleid="route-out-approved"]');
  const target = page.getByTestId('state-stopped').locator('[data-handleid="in"]');
  const a = (await source.boundingBox())!, b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 16 });
  await page.mouse.up();
  await expect(page.getByLabel('目标状态', { exact: true })).toHaveValue('stopped');
  await expect(page.getByLabel('跳转条件', { exact: true })).toHaveValue('质量检查通过');
  const saved = await savedProject(page);
  expect(saved.machine.transitions).toHaveLength(7);
  expect(saved.machine.transitions.find(t => t.id === 'approved')).toMatchObject({ to: 'stopped', condition: '质量检查通过', requiredQuality: ['coverage'] });
});

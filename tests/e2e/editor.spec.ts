import { expect, test } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { createTemplate } from '../../src/domain/templates';

test('edit guidance, persist, export the same description and install a portable Skill', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const directory = await mkdtemp(join(tmpdir(), 'decoupleflow-browser-'));
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '外部分析与评审', exact: true })).toBeVisible();
    await expect(page.getByTestId('state-waiting')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('editor.png'), fullPage: true });
    await page.getByRole('button', { name: '工具与策略', exact: true }).click();
    await page.getByLabel('配置说明', { exact: true }).fill('查询间隔 42 秒；只查询原始任务 ID。');
    await expect(page.getByText('已保存在本机')).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: '工具与策略', exact: true }).click();
    await expect(page.getByLabel('配置说明', { exact: true })).toHaveValue('查询间隔 42 秒；只查询原始任务 ID。');
    await page.getByRole('button', { name: '描述预览', exact: true }).click();
    await expect(page.locator('.markdown-document')).toContainText('查询间隔 42 秒');
    await page.getByRole('button', { name: '标签描述', exact: true }).click();
    await expect(page.locator('.source-document')).toContainText('<Configuration>查询间隔 42 秒');
    await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('技能包')).toBeVisible();
    const downloadEvent = page.waitForEvent('download');
    await dialog.getByRole('button', { name: '下载 ZIP', exact: true }).click();
    const download = await downloadEvent;
    const files = unzipSync(await readFile((await download.path())!));
    expect(strFromU8(files['.agents/skills/df-analysis-review/references/state-machine.md'])).toContain('查询间隔 42 秒');
    await dialog.getByRole('button', { name: '指定项目', exact: true }).click();
    await dialog.getByLabel('项目目录', { exact: true }).fill(directory);
    await expect(dialog.getByText('准备安装 12 个文件')).toBeVisible();
    await dialog.getByRole('button', { name: '安装到 Agent', exact: true }).click();
    await expect(dialog.getByText('安装完成', { exact: true })).toBeVisible();
    const installed = join(directory, '.agents/skills/df-analysis-review/SKILL.md');
    expect(await readFile(installed, 'utf8')).toContain('自主完成工作');
    await page.screenshot({ path: testInfo.outputPath('export.png'), fullPage: true });
    await writeFile(installed, '手工调整的技能内容');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: '指定项目', exact: true }).click();
    await page.getByRole('dialog').getByLabel('项目目录', { exact: true }).fill(directory);
    await expect(page.getByRole('dialog').getByText(/SKILL.md 被修改/)).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button', { name: '安装到 Agent', exact: true })).toBeDisabled();
    expect(await readFile(installed, 'utf8')).toBe('手工调整的技能内容');
    expect(errors).toEqual([]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('edit transition quality requirements and undo node deletion', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('edge-ready').click();
  await page.getByLabel('跳转条件', { exact: true }).fill('原任务成功，结果可读取');
  await expect(page.getByLabel('结果属于当前任务，且内容能够读取。')).toBeChecked();
  await page.getByLabel('结果属于当前任务，且内容能够读取。').uncheck();
  await page.getByRole('button', { name: 'Skill 文件', exact: true }).click();
  await page.getByRole('button', { name: 'state-machine.json', exact: true }).click();
  const definition = JSON.parse(await page.locator('.code-view pre').innerText());
  expect(definition.transitions.find((t: { id: string }) => t.id === 'ready')).toMatchObject({ condition: '原任务成功，结果可读取', requiredQuality: [] });
  await page.getByRole('button', { name: '状态机', exact: true }).click();
  await page.locator('.state-outline').getByRole('button', { name: '等待外部结果', exact: true }).click();
  await page.getByRole('button', { name: '删除状态', exact: true }).click();
  await expect(page.getByTestId('state-waiting')).toHaveCount(0);
  await expect(page.getByTestId('edge-ready')).toHaveCount(0);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(page.getByTestId('state-waiting')).toBeVisible();
  await expect(page.getByTestId('edge-ready')).toBeVisible();
});

test('creates a state, connects it and round-trips the project JSON', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '新建状态机' }).click();
  await page.getByRole('button', { name: /空白状态机/ }).click();
  await page.locator('.state-palette').getByRole('button', { name: '工作状态', exact: true }).click();
  await page.getByLabel('状态名称', { exact: true }).fill('准备发布');
  await page.getByLabel('状态说明', { exact: true }).fill('整理已审核的材料。');
  await page.locator('.state-palette').getByRole('button', { name: '结束状态', exact: true }).click();
  await page.getByLabel('状态名称', { exact: true }).fill('发布完成');
  await page.getByLabel('状态说明', { exact: true }).fill('向用户交付最终材料。');
  await page.locator('.state-outline').getByRole('button', { name: '准备发布' }).click();
  await page.getByRole('button', { name: '条件与跳转', exact: true }).click();
  await page.locator('.section-label').filter({ hasText: '下个步骤' }).getByRole('button', { name: '添加' }).click();
  await page.getByLabel('跳转条件', { exact: true }).fill('材料审核完成');
  await expect(page.locator('.transition-label')).toHaveText('材料审核完成');
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存文件', exact: true }).click();
  const file = await event; const bytes = await readFile((await file.path())!);
  const saved = JSON.parse(bytes.toString()); expect(saved.machine.states).toHaveLength(2); expect(saved.machine.transitions).toHaveLength(1);
  await page.getByLabel('选择项目文件').setInputFiles({ name: 'project.json', mimeType: 'application/json', buffer: bytes });
  await expect(page.getByRole('status')).toContainText('已导入为独立状态机');
  await expect(page.locator('.state-card')).toHaveCount(2);
  await expect(page.locator('.transition-label')).toHaveText('材料审核完成');
  await expect(page.getByLabel('选择状态机').locator('option')).toHaveCount(3);
});

test('imports a nested machine, collapses it and preserves its entry in the exported definition', async ({ page }) => {
  const project = createTemplate('simple');
  project.machine.states[1].kind = 'subflow'; project.machine.states[1].initialState = 'inside';
  project.machine.states.push({ ...structuredClone(project.machine.states[2]), id: 'inside', name: '内部结束', parentId: 'work' });
  project.layout.inside = { x: 40, y: 130 };
  await page.goto('/');
  await page.getByLabel('选择项目文件').setInputFiles({ name: 'nested.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByTestId('state-inside')).toBeVisible();
  await page.getByRole('button', { name: '折叠子状态机' }).click();
  await expect(page.getByTestId('state-inside')).toHaveCount(0);
  await page.getByRole('button', { name: '展开子状态机' }).click();
  await expect(page.getByTestId('state-inside')).toBeVisible();
  await page.getByRole('button', { name: 'Skill 文件', exact: true }).click();
  await page.getByRole('button', { name: 'state-machine.json', exact: true }).click();
  expect(JSON.parse(await page.locator('.code-view pre').innerText()).states.find((s: { id: string }) => s.id === 'work').initialState).toBe('inside');
});

test('small viewport keeps export and canvas controls available', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await expect(page.getByRole('button', { name: '适应画布' })).toBeVisible();
  await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
  await expect(page.getByRole('button', { name: '下载 ZIP', exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('mobile.png'), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('connects states using canvas handles and allows undoing a dragged position', async ({ page }) => {
  await page.goto('/');
  const source = page.locator('.react-flow__node[data-id="prepare"] .react-flow__handle[data-handleid="out"]');
  const target = page.locator('.react-flow__node[data-id="review"] .react-flow__handle[data-handleid="in"]');
  await expect(source).toBeVisible();
  // A user waits for the initial fit-to-canvas animation before drawing.
  await page.waitForTimeout(400);
  const a = (await source.boundingBox())!, b = (await target.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect(page.getByLabel('跳转条件', { exact: true })).toBeVisible();
  await page.getByLabel('跳转条件', { exact: true }).fill('已有结果，直接评审');
  await expect(page.locator('.transition-label')).toHaveCount(8);
  const node = page.getByTestId('state-prepare'); const before = (await node.boundingBox())!;
  const edgeProbe = await page.evaluateHandle(() => {
    const paths = [...document.querySelectorAll('.react-flow__edge-path')];
    const stats = { removed: 0 };
    const observer = new MutationObserver(records => {
      for (const record of records) for (const removed of record.removedNodes) {
        if (paths.some(path => removed === path || removed.contains(path))) stats.removed++;
      }
    });
    observer.observe(document.querySelector('.react-flow')!, { subtree: true, childList: true });
    return { paths, stats, observer };
  });
  await page.mouse.move(before.x + 70, before.y + 40);
  await page.mouse.down(); await page.mouse.move(before.x + 70, before.y - 40, { steps: 8 }); await page.mouse.up();
  expect((await node.boundingBox())!.y).toBeLessThan(before.y - 50);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  expect(Math.abs((await node.boundingBox())!.y - before.y)).toBeLessThan(2);
  const edges = await edgeProbe.evaluate(({ paths, stats, observer }) => {
    observer.disconnect();
    return { count: paths.length, retained: paths.filter(path => path.isConnected).length, removed: stats.removed };
  });
  expect(edges.count).toBe(8);
  expect(edges.retained).toBe(8);
  expect(edges.removed).toBe(0);
  await edgeProbe.dispose();
});

test('keeps an unfinished identifier as a local draft and blocks invalid Skill export', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '状态机设置', exact: true }).click();
  await page.getByLabel('唯一标识').fill('Work In Progress');
  await expect(page.getByText('已保存在本机')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '状态机设置', exact: true }).click();
  await expect(page.getByLabel('唯一标识')).toHaveValue('Work In Progress');
  await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('标识只能包含小写字母');
  await expect(page.getByRole('dialog').getByRole('button', { name: '导出 / 接入', exact: true })).toBeDisabled();
});

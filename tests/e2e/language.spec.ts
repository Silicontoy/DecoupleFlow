import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { strFromU8, unzipSync } from 'fflate';
import { createTemplate } from '../../src/domain/templates';

test.use({ storageState: { cookies: [], origins: [] } });

async function switchExportLanguage(page: Page, language: 'en' | 'zh', route = 'Agent Skill') {
  await page.keyboard.press('Escape');
  await page.getByLabel('Language', { exact: true }).selectOption(language);
  await page.getByRole('button', { name: language === 'en' ? 'Export / Connect' : '导出 / 接入', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Language', { exact: true })).toHaveCount(0);
  if (route !== 'Agent Skill') await page.getByRole('dialog').getByRole('button', { name: route, exact: true }).click();
}


test('defaults to English, remembers Chinese, and preserves saved machine content when switching', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'External analysis and review', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export / Connect', exact: true })).toBeVisible();
  await page.getByLabel('State name', { exact: true }).fill('我的状态 $& {0}');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('decoupleflow.workspace.v1')!).documents);
  await page.screenshot({ path: testInfo.outputPath('english-workspace.png'), fullPage: true });
  await page.getByLabel('Language', { exact: true }).selectOption('zh');
  await expect(page.getByRole('button', { name: '导出 / 接入', exact: true })).toBeVisible();
  await expect(page.getByLabel('状态名称', { exact: true })).toHaveValue('我的状态 $& {0}');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
  await expect(page.getByLabel('Language', { exact: true })).toHaveValue('zh');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('decoupleflow.workspace.v1')!).documents)).toEqual(before);
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Description', exact: true }).click();
  await expect(page.locator('.markdown-document')).toContainText('State machine overview');
  await expect(page.getByTestId('state-diagram').locator('svg')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('english-description.png'), fullPage: true });
  await page.getByRole('button', { name: /^New machine/ }).click();
  await page.getByRole('dialog').getByRole('button', { name: /Loops and conditional branches/ }).click();
  await page.getByTestId('state-repeat').click();
  await page.getByRole('button', { name: 'Conditions & paths', exact: true }).click();
  await expect(page.locator('.route-editor-heading').filter({ hasText: 'Continue loop' })).toBeVisible();
  await page.setViewportSize({ width: 720, height: 900 });
  await expect(page.getByLabel('Language', { exact: true })).toBeVisible();
  const selector = await page.getByLabel('Language', { exact: true }).boundingBox();
  expect(selector!.x + selector!.width).toBeLessThanOrEqual(720);
  expect(errors).toEqual([]);
});

test('switches exports through the global language selector and discovers directories once per opening', async ({ page }, testInfo) => {
  test.setTimeout(60000);
  const root = await mkdtemp(join(tmpdir(), 'df-language-ui-'));
  let scans = 0;
  await page.route('**/api/agents/directories', route => { scans++; return route.fulfill({ json: { projects: [], profiles: [], notes: [], scannedAt: new Date().toISOString() } }); });
  try {
    await page.goto('/');
    const project = createTemplate('simple'); project.machine.id = 'language-export'; project.machine.states[0].description = '用户原文 $& {0}';
    await page.getByLabel('Choose project file').setInputFiles({ name: 'language.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Export / Connect', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.locator('.code-view')).toContainText('## On every invocation');
    await expect(dialog.getByRole('button', { name: 'Copy command', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Project', exact: true }).click();
    await dialog.getByLabel('Project directory', { exact: true }).fill(root);
    await expect(dialog.getByRole('button', { name: 'Install to agent', exact: true })).toBeEnabled();
    const downloaded = page.waitForEvent('download');
    await dialog.getByRole('button', { name: 'Download ZIP', exact: true }).click();
    const zip = unzipSync(await readFile((await (await downloaded).path())!));
    const prefix = '.agents/skills/df-language-export/';
    expect(strFromU8(zip[prefix + 'SKILL.md'])).toContain('## On every invocation');
    expect(strFromU8(zip[prefix + 'references/state-machine.md'])).toContain('用户原文 $& {0}');
    await dialog.getByRole('button', { name: 'Install to agent', exact: true }).click();
    await expect(dialog.locator('.installed-card')).toContainText('Installed');
    const installed = join(root, prefix);
    const english = await readFile(join(installed, 'SKILL.md'), 'utf8');
    expect(english).toBe(strFromU8(zip[prefix + 'SKILL.md']));
    const englishManifest = JSON.parse(await readFile(join(installed, 'decoupleflow-manifest.json'), 'utf8'));
    await page.screenshot({ path: testInfo.outputPath('english-export.png'), fullPage: true });
    await switchExportLanguage(page, 'zh');
    await expect(dialog.locator('.code-view')).toContainText('## 每次调用');
    await dialog.getByRole('button', { name: '指定项目', exact: true }).click();
    await dialog.getByLabel('项目目录', { exact: true }).fill(root);
    await expect(dialog.getByRole('button', { name: '安装到 Agent', exact: true })).toBeEnabled();
    await dialog.getByRole('button', { name: '安装到 Agent', exact: true }).click();
    await expect(dialog.locator('.installed-card')).toContainText('安装完成');
    expect(await readFile(join(installed, 'SKILL.md'), 'utf8')).toContain('## 每次调用');
    const chineseManifest = JSON.parse(await readFile(join(installed, 'decoupleflow-manifest.json'), 'utf8'));
    expect(chineseManifest.language).toBe('zh'); expect(chineseManifest.semanticHash).toBe(englishManifest.semanticHash);
    await switchExportLanguage(page, 'en');
    await dialog.getByRole('button', { name: 'LangChain / LangGraph', exact: true }).click();
    await dialog.getByRole('button', { name: 'README.md', exact: true }).click();
    await expect(dialog.locator('.code-view')).toContainText('## Connect an existing agent');
    await dialog.getByRole('button', { name: 'Dify', exact: true }).click();
    await expect(dialog.locator('.code-view')).toContainText('Instance and execution evidence');
    await switchExportLanguage(page, 'zh', 'Dify');
    await expect(dialog.locator('.code-view')).toContainText('实例与执行证据');
    await dialog.getByRole('button', { name: 'Agent Skill', exact: true }).click();
    await expect(dialog.getByLabel('Agent 用户主目录', { exact: true })).toBeVisible();
    expect(scans).toBe(4);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('the English export opens a working English live execution window', async ({ page }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'df-language-monitor-')); let pid = 0;
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Export / Connect', exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('dialog').getByRole('button', { name: 'Download ZIP', exact: true }).click();
    const files = unzipSync(await readFile((await (await download).path())!));
    for (const [path, bytes] of Object.entries(files)) { const target = join(root, path); await mkdir(dirname(target), { recursive: true }); await writeFile(target, bytes); }
    const script = join(root, Object.keys(files).find(p => p.endsWith('/scripts/run.mjs'))!);
    const run = async (...args: string[]) => JSON.parse((await promisify(execFile)(process.execPath, [script, ...args], { timeout: 10000 })).stdout);
    const opened = await run('start', '--workspace', root, '--no-open');
    pid = JSON.parse(await readFile(join(opened.instance, 'monitor.json'), 'utf8')).pid;
    await page.goto(opened.viewerUrl);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('#phase')).toHaveText('Running');
    await expect(page.locator('#state')).toHaveText('Prepare analysis');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('#phase')).toHaveText('Paused');
    await page.screenshot({ path: testInfo.outputPath('english-live-window.png'), fullPage: true });
    await page.getByRole('button', { name: 'End and archive', exact: true }).click();
    await expect(page.locator('#archive-receipt')).toContainText('This instance is archived');
    await expect(page.locator('#phase')).toHaveText('Archived');
    expect(errors).toEqual([]);
  } finally { if (pid) { try { process.kill(pid); } catch {} } await rm(root, { recursive: true, force: true }); }
});

import { expect, test, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createTemplate } from '../../src/domain/templates';
import type { AgentDirectories, DirectoryAgent } from '../../src/domain/agentDirectories';

let root: string, data: AgentDirectories;
test.beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'df-directory-ui-'));
  for (const path of ['codex-repo', 'claude-repo', 'shared-repo', 'windows-user', 'linux-user', 'manual-repo']) await mkdir(join(root, path));
  const src = (agent: DirectoryAgent) => ({ agent, label: `${agent} 项目记录`, file: join(root, agent, 'records.json'), userHome: join(root, 'windows-user') });
  data = {
    scannedAt: new Date().toISOString(), notes: [],
    projects: [
      { name: 'Codex 项目', path: join(root, 'codex-repo'), originalPath: 'B:\\codex-repo', available: true, status: '可用', lastUsed: null, sources: [src('codex')] },
      { name: 'Claude 项目', path: join(root, 'claude-repo'), originalPath: 'B:\\claude-repo', available: true, status: '可用', lastUsed: null, sources: [src('claude')] },
      { name: '共享项目', path: join(root, 'shared-repo'), originalPath: 'B:\\shared-repo', available: true, status: '可用', lastUsed: null, sources: [src('codex'), src('claude')] },
      { name: '失效项目', path: join(root, 'removed-repo'), originalPath: 'B:\\removed-repo', available: false, status: '目录已不存在', lastUsed: null, sources: [src('claude')] },
    ],
    profiles: [
      { agent: 'codex', userHome: join(root, 'linux-user'), configDirectory: join(root, 'linux-user/.codex') },
      { agent: 'codex', userHome: join(root, 'windows-user'), configDirectory: join(root, 'windows-user/.codex') },
      { agent: 'claude', userHome: join(root, 'windows-user'), configDirectory: join(root, 'windows-user/.claude') },
    ],
  };
});
test.afterEach(async () => { await rm(root, { recursive: true, force: true }); });
async function openExport(page: Page) {
  const project = createTemplate('simple'); project.machine.id = 'directory-picker-test';
  await page.goto('/');
  await page.getByLabel('选择项目文件').setInputFiles({ name: 'directory-test.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
  return page.getByRole('dialog');
}

test('reads once on opening, reuses directories across tabs and installs only to the explicit destination', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  let scans = 0;
  await page.route('**/api/agents/directories', async route => { scans++; await route.fulfill({ json: data }); });
  const dialog = await openExport(page);
  await expect(dialog.getByRole('status')).toHaveText('已找到 4 个项目，2 个适用的个人目录');
  expect(scans).toBe(1);
  await expect(dialog.locator('.directory-picker-actions button')).toHaveCount(1);
  await expect(dialog.getByRole('button', { name: '刷新项目目录', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '指定项目', exact: true }).click();
  await expect(dialog.getByLabel('项目目录', { exact: true })).toHaveValue('');
  await dialog.getByRole('button', { name: 'Dify', exact: true }).click();
  await dialog.getByRole('button', { name: 'Agent Skill', exact: true }).click();
  await expect(dialog.locator('.directory-project-list button')).toHaveCount(4);
  expect(scans).toBe(1);
  await expect(dialog.getByLabel('项目目录', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '安装到 Agent', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: `使用项目 失效项目 ${join(root, 'removed-repo')}`, exact: true })).toBeDisabled();
  await dialog.getByLabel('搜索 Agent 项目').fill('B:\\codex-repo');
  await expect(dialog.locator('.directory-project-list button')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('agent-directory-picker.png'), fullPage: true });
  await dialog.getByRole('button', { name: `使用项目 Codex 项目 ${join(root, 'codex-repo')}`, exact: true }).click();
  await expect(dialog.getByLabel('项目目录', { exact: true })).toHaveValue(join(root, 'codex-repo'));
  const codexSkill = join(root, 'codex-repo/.agents/skills/df-directory-picker-test');
  await expect(dialog.locator('.install-path')).toContainText(codexSkill);
  expect(await readdir(join(root, 'codex-repo'))).toEqual([]);
  await expect(dialog.getByRole('button', { name: '安装到 Agent', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '安装到 Agent', exact: true }).click();
  await expect(dialog.locator('.installed-card')).toContainText(codexSkill);
  expect(await readFile(join(codexSkill, 'SKILL.md'), 'utf8')).toContain('df-directory-picker-test');

  await dialog.locator('.target-card').filter({ hasText: 'Claude Code' }).click();
  await expect(dialog.locator('.directory-personal-list button')).toHaveCount(1);
  await dialog.getByRole('button', { name: `使用个人目录 ${join(root, 'windows-user')}`, exact: true }).click();
  await expect(dialog.getByRole('button', { name: '个人目录（默认）', exact: true })).toHaveClass('active');
  await expect(dialog.getByLabel('Agent 用户主目录')).toHaveValue(join(root, 'windows-user'));
  const claudeSkill = join(root, 'windows-user/.claude/skills/df-directory-picker-test');
  await expect(dialog.locator('.install-path')).toContainText(claudeSkill);
  await expect(dialog.getByRole('button', { name: '安装到 Agent', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: '安装到 Agent', exact: true }).click();
  await expect(dialog.locator('.installed-card')).toContainText(claudeSkill);
  expect(await readFile(join(claudeSkill, 'SKILL.md'), 'utf8')).toContain('df-directory-picker-test');
  await dialog.getByRole('button', { name: '指定项目', exact: true }).click();
  await expect(dialog.getByLabel('项目目录', { exact: true })).toHaveValue(join(root, 'codex-repo'));
  expect(scans).toBe(1); expect(errors).toEqual([]);
  await dialog.getByRole('button', { name: '关闭弹窗', exact: true }).click();
  await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
  await expect(dialog.getByRole('status')).toHaveText('已找到 4 个项目，2 个适用的个人目录');
  expect(scans).toBe(2);
});

test('retries discovery without replacing typed paths and filters projects by Agent source', async ({ page }) => {
  let scans = 0;
  await page.route('**/api/agents/directories', async route => {
    scans++;
    await route.fulfill(scans === 1 ? { status: 503, json: { error: '本机目录暂时无法读取，请重试。' } } : { json: data });
  });
  const dialog = await openExport(page);
  await expect(dialog.getByRole('alert')).toHaveText('本机目录暂时无法读取，请重试。');
  await dialog.getByRole('button', { name: '指定项目', exact: true }).click();
  await dialog.getByLabel('项目目录', { exact: true }).fill(join(root, 'manual-repo'));
  expect(scans).toBe(1);
  await dialog.getByRole('button', { name: '刷新项目目录', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('已找到 4 个项目');
  await expect(dialog.getByLabel('项目目录', { exact: true })).toHaveValue(join(root, 'manual-repo'));
  await dialog.getByLabel('项目目录来源').selectOption('claude');
  await expect(dialog.locator('.directory-project-list button')).toHaveCount(3);
  await dialog.getByLabel('搜索 Agent 项目').fill('无匹配项目');
  await expect(dialog.locator('.directory-project-list')).toContainText('没有匹配的项目');
  await dialog.getByLabel('搜索 Agent 项目').fill('shared-repo');
  await expect(dialog.locator('.directory-project-list button')).toHaveCount(1);
  await dialog.getByRole('button', { name: '刷新项目目录', exact: true }).click();
  await expect.poll(() => scans).toBe(3);
  await expect(dialog.getByRole('status')).toContainText('已找到 4 个项目');
  await expect(dialog.getByLabel('项目目录', { exact: true })).toHaveValue(join(root, 'manual-repo'));
  await dialog.getByRole('button', { name: `使用项目 共享项目 ${join(root, 'shared-repo')}`, exact: true }).click();
  await expect(dialog.getByLabel('项目目录', { exact: true })).toHaveValue(join(root, 'shared-repo'));
});

test('keeps manual installation available when no Agent records exist', async ({ page }) => {
  await page.route('**/api/agents/directories', route => route.fulfill({ json: { projects: [], profiles: [], notes: [], scannedAt: new Date().toISOString() } }));
  const dialog = await openExport(page);
  await expect(dialog.locator('.directory-project-list')).toContainText('没有找到项目记录');
  await dialog.getByRole('button', { name: '指定项目', exact: true }).click();
  await dialog.getByLabel('项目目录', { exact: true }).fill(join(root, 'manual-repo'));
  await expect(dialog.getByRole('button', { name: '安装到 Agent', exact: true })).toBeEnabled();
});

import { expect, test } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { strFromU8, unzipSync } from 'fflate';
import { createTemplate } from '../../src/domain/templates';
import { runtime } from '../../src/domain/runtime';
import { answer } from '../adapter-fixtures';
const exec = promisify(execFile);
test('an actually invoked exported Skill starts its own live window and archives its real execution', async ({ page }, testInfo) => {
  const root = await mkdtemp(join(tmpdir(), 'df-live-browser-')); let pid = 0;
  try {
    const project = createTemplate('simple'); await page.goto('/');
    await page.getByLabel('选择项目文件').setInputFiles({ name: 'simple.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
    await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
    const downloaded = page.waitForEvent('download'); await page.getByRole('dialog').getByRole('button', { name: '下载 ZIP', exact: true }).click();
    const files = unzipSync(await readFile((await (await downloaded).path())!));
    for (const [path, bytes] of Object.entries(files)) { const dest = join(root, path); await mkdir(dirname(dest), { recursive: true }); await writeFile(dest, bytes); }
    const script = join(root, Object.keys(files).find(p => p.endsWith('/scripts/run.mjs'))!);
    expect(strFromU8(files[Object.keys(files).find(p => p.endsWith('/SKILL.md'))!])).toContain('scripts/run.mjs start');
    const run = async (...args: string[]) => JSON.parse((await exec(process.execPath, [script, ...args], { timeout: 10000 })).stdout);
    const opened = await run('start', '--workspace', root, '--actor', '浏览器测试 Agent', '--no-open');
    pid = JSON.parse(await readFile(join(opened.instance, 'monitor.json'), 'utf8')).pid;
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(opened.viewerUrl); await expect(page.locator('#state')).toHaveText(project.machine.states.find(s => s.id === 'prepare')!.name);
    await expect(page.locator('[data-state="prepare"]')).toHaveAttribute('data-status', 'active');
    const event = join(root, 'event.json'); await writeFile(event, JSON.stringify({ type: 'external.waiting', detail: '实际等待 job-42' }));
    await run('event', '--instance', opened.instance, '--event', event);
    await expect(page.locator('[data-state="prepare"]')).toHaveAttribute('data-status', 'waiting');
    await expect(page.locator('#waiting')).toContainText('job-42');
    await page.getByRole('button', { name: '注入事件', exact: true }).click();
    await page.getByLabel('运行事件 JSON').fill(JSON.stringify({ type: 'external.completed', detail: 'job-42 返回真实结果' }));
    await page.getByRole('button', { name: '提交事件', exact: true }).click();
    await expect(page.locator('#timeline')).toContainText('external.completed');
    await page.screenshot({ path: testInfo.outputPath('skill-live-window.png'), fullPage: true });
    for (let i = 0; i < 3; i++) {
      const record = (await run('status', '--instance', opened.instance)).record;
      const path = join(root, 'decision.json'); await writeFile(path, JSON.stringify(answer(project.machine, record, runtime.candidates(project.machine, record)[0].id)));
      await run('advance', '--instance', opened.instance, '--decision', path);
    }
    await expect(page.locator('#archive-receipt')).toBeVisible(); await expect(page.locator('#timeline')).toContainText('run.archived');
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeDisabled();
    const next = await run('start', '--workspace', root, '--visualization', 'off'); expect(next.record.currentState).toBe('prepare'); expect(next.record.instanceId).not.toBe(opened.record.instanceId);
    expect(errors).toEqual([]);
  } finally { if (pid) { try { process.kill(pid); } catch {} } await rm(root, { recursive: true, force: true }); }
});

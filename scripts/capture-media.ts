import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { chromium, expect, type Page } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { createTemplate } from '../src/domain/templates';
import { newState, type Project } from '../src/domain/types';
import { runtime, type RunRecord } from '../src/domain/runtime';
import { translator } from '../src/i18n/translate';
import { verificationMachine } from '../examples/verified/fixture';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = join(root, '.media-work'); const docs = join(root, 'docs');
const base = process.env.MEDIA_BASE_URL || 'http://127.0.0.1:4173';
const tr = translator('en'); const exec = promisify(execFile);
await mkdir(work, { recursive: true });
const demoHome = '/tmp/decoupleflow-media-home'; await mkdir(demoHome, { recursive: true });
const project: Project = { format: 'decoupleflow-project', schemaVersion: 1, machine: verificationMachine(), layout: { prepare: { x: 30, y: 120 }, review: { x: 400, y: 120 }, done: { x: 800, y: 120 } } };
project.machine.id = 'release-readiness'; project.machine.name = 'Release readiness'; project.machine.initialState = 'prepare';
project.machine.states.unshift({ ...newState('task', 'prepare', 'Gather evidence'), description: 'Collect the license, test results, and README before starting the review.' });
project.machine.states.forEach(state => { state.strategies = { during: 'Check the actual files.', onFailure: 'Record the gap and retry after correction.', onUncertain: 'Hold the current state and request evidence.' }; });
project.machine.transitions.unshift({ id: 'prepared', from: 'prepare', to: 'review', condition: 'Release artifacts are available.', requiredQuality: [], kind: 'normal', onUncertain: 'Collect the missing artifacts.' });
project.machine.visualization = { enabled: true, autoOpen: false };
const browser = await chromium.launch({ ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const pictures: string[] = []; let monitorPid = 0;
const errors: string[] = [];
async function context(video = false) {
  const context = await browser.newContext({ viewport: { width: 1536, height: 960 }, deviceScaleFactor: 1, ...(video ? { recordVideo: { dir: join(work, 'video'), size: { width: 1536, height: 960 } } } : {}) });
  await context.addInitScript(() => localStorage.setItem('decoupleflow.language', 'en'));
  // Public captures use sample home/discovery data; the UI, exports and run APIs are real.
  await context.route('**/api/info', async route => { const response = await route.fetch(); const info = await response.json(); await route.fulfill({ response, json: { ...info, userHome: demoHome } }); });
  await context.route('**/api/agents/directories', route => route.fulfill({ json: { projects: [], profiles: [], notes: [], scannedAt: new Date().toISOString() } }));
  return context;
}
const button = (page: Page, name: string) => page.getByRole('button', { name: tr(name), exact: true });
async function open(page: Page, value: Project) {
  await page.goto(base); page.on('pageerror', error => errors.push(error.message));
  await page.getByLabel(tr('选择项目文件')).setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await expect(page.getByText(tr('已保存在本机'), { exact: true })).toBeVisible();
  if (await button(page, '关闭通知').isVisible()) await button(page, '关闭通知').click();
  await page.waitForTimeout(600);
}
async function shot(page: Page, file: string) { if (await button(page, '关闭通知').isVisible()) await button(page, '关闭通知').click(); await page.waitForTimeout(450); await page.screenshot({ path: join(docs, file) }); pictures.push(file); }
async function showDiagram(page: Page) {
  await expect(page.getByTestId('state-diagram')).toHaveClass(/ready/);
  await page.locator('.markdown-document').evaluate(element => { element.scrollTop += element.querySelector('.mermaid-diagram')!.getBoundingClientRect().top - element.getBoundingClientRect().top - 20; });
}
const decide = (machine: Project['machine'], record: RunRecord, evidence: string) => {
  const next = runtime.candidates(machine, record)[0];
  return { transitionId: next.id, conditionMet: true, targetEntryMet: true, passedQuality: next.requiredQuality, evidence };
};
try {
  const stills = await context(); const page = await stills.newPage();
  await open(page, createTemplate('analysis', 'en')); await shot(page, 'editor.png');
  await open(page, project);
  await button(page, '描述预览').click(); await expect(page.getByTestId('state-diagram').locator('svg')).toBeVisible();
  await showDiagram(page);
  await shot(page, 'state-machine-markdown.png');
  await open(page, createTemplate('analysis', 'en'));
  await button(page, '导出 / 接入').click(); await expect(page.getByRole('dialog').locator('.file-preview')).toBeVisible();
  await shot(page, 'export.png');
  await button(page, 'LangChain / LangGraph').click(); await expect(page.getByRole('dialog').locator('.file-preview')).toContainText('workflow.mjs');
  await shot(page, 'workflow-export.png'); await button(page, 'Dify').click();
  await expect(page.getByRole('dialog').locator('.file-preview')).toContainText('workflow.yml'); await shot(page, 'dify-export.png');
  await page.keyboard.press('Escape'); await open(page, createTemplate('loop', 'en'));
  await shot(page, 'loop-and-routing.png'); await page.getByTestId('state-repeat').click();
  await button(page, '条件与跳转').click(); await shot(page, 'loop-node.png');
  await open(page, project); await page.getByTestId('state-review').click(); await shot(page, 'list-state.png');
  await button(page, '推进').click(); await expect(page.getByTestId('execution-workbench')).toBeVisible();
  await expect(page.getByText(tr('实时连接'), { exact: true })).toBeVisible();
  const record = await page.evaluate(() => { const w = JSON.parse(localStorage.getItem('decoupleflow.workspace.v1')!); return JSON.parse(localStorage.getItem(`decoupleflow.instance.${w.active}`)!); });
  const activeMachine = await page.evaluate(() => { const w = JSON.parse(localStorage.getItem('decoupleflow.workspace.v1')!); return w.documents.find((d: { key: string }) => d.key === w.active).project.machine; });
  const info = await (await page.request.get(`${base}/api/info`)).json();
  const openedRun = await (await page.request.post(`${base}/api/runs/open`, { headers: { 'X-DecoupleFlow-Token': info.token }, data: { machine: activeMachine, record } })).json();
  const event = await page.request.post(`${base}/api/runs/event`, { headers: { 'X-DecoupleFlow-Run-Token': openedRun.eventToken }, data: { runId: record.instanceId, expectedRevision: record.revision, type: 'agent.completed', actor: 'Demo Harness', detail: 'Collected release artifacts for the checklist.' } });
  assert.equal(event.status(), 200);
  await page.getByLabel(tr('Agent 决策 JSON')).fill(JSON.stringify(decide(activeMachine, record, 'Demo harness: the three fixture artifacts are available.')));
  await button(page, '单步').click(); await expect(page.getByTestId('runtime-current-state')).toHaveText('Review release');
  await page.locator('.runtime-view').evaluate(element => { element.scrollTop += element.querySelector('.execution-workbench')!.getBoundingClientRect().top - element.getBoundingClientRect().top - 12; });
  await shot(page, 'execution-workbench.png'); await stills.close();

  const movie = await context(true); const screen = await movie.newPage();
  const video = screen.video()!; const recordingStart = Date.now();
  await open(screen, project); const leadIn = (Date.now() - recordingStart) / 1000;
  const start = Date.now(); const chapters: { at: number; title: string }[] = [];
  async function chapter(title: string, ms: number) { chapters.push({ at: Math.round((Date.now() - start) / 100) / 10, title }); await screen.waitForTimeout(ms); }
  await chapter('Design the process', 3000);
  await screen.getByTestId('state-review').click(); await chapter('Ordered items, one shared pass condition', 4000);
  await button(screen, '条件与跳转').click(); await chapter('Choose when the state can exit', 2500);
  await button(screen, '描述预览').click(); await expect(screen.getByTestId('state-diagram').locator('svg')).toBeVisible();
  await showDiagram(screen);
  await chapter('Readable Markdown and the complete Mermaid graph', 4000);
  await button(screen, '导出 / 接入').click(); await expect(screen.getByRole('dialog').locator('.file-preview')).toBeVisible();
  await chapter('Export a portable Agent Skill', 3000);
  await screen.locator('.export-route-tabs').getByRole('button', { name: 'Markdown', exact: true }).click(); await button(screen, '复制 Mermaid').click(); await chapter('Copy the Mermaid block in one click', 2000);
  await button(screen, 'LangChain / LangGraph').click(); await expect(screen.getByRole('dialog').locator('.file-preview')).toContainText('workflow.mjs'); await chapter('Optional LangGraph export', 2000);
  await button(screen, 'Dify').click(); await expect(screen.getByRole('dialog').locator('.file-preview')).toContainText('workflow.yml'); await chapter('Optional Dify export', 2000);
  await button(screen, 'Agent Skill').click();
  const downloading = screen.waitForEvent('download'); await button(screen, '下载 ZIP').click(); const download = await downloading;
  const files = unzipSync(await readFile((await download.path())!));
  for (const [path, content] of Object.entries(files)) { const output = join(work, 'export', path); await mkdir(dirname(output), { recursive: true }); await writeFile(output, content); }
  const runnerFile = Object.keys(files).find(path => path.endsWith('/scripts/run.mjs'))!;
  const machineFile = Object.keys(files).find(path => path.endsWith('/references/state-machine.json'))!;
  const machine = JSON.parse(strFromU8(files[machineFile]));
  const run = async (...args: string[]) => JSON.parse((await exec(process.execPath, [join(work, 'export', runnerFile), ...args], { timeout: 15000 })).stdout);
  const opened = await run('start', '--workspace', work, '--actor', 'Demo Harness', '--no-open');
  monitorPid = JSON.parse(await readFile(join(opened.instance, 'monitor.json'), 'utf8')).pid;
  await screen.goto(opened.viewerUrl); await expect(screen.locator('[data-state="prepare"]')).toBeVisible();
  await chapter('The exported Skill opens its own live window', 3000);
  let current = opened.record as RunRecord;
  const sources = ['LICENSE', 'docs/verification/tests.json', 'README.md'];
  for (let step = 0; step < 6; step++) {
    const source = sources[Math.max(0, Math.min(step - 1, 2))]; const content = await readFile(join(root, source));
    assert(content.length > 0); const evidence = `Demo Harness read ${source}: ${content.length} bytes, sha256=${createHash('sha256').update(content).digest('hex')}. This demonstration uses fixture checks; it does not call an LLM.`;
    await writeFile(join(work, 'decision.json'), JSON.stringify(decide(machine, current, evidence)));
    current = (await run('advance', '--instance', opened.instance, '--decision', join(work, 'decision.json'))).record;
    if (step === 1) await shot(screen, 'skill-execution-window.png');
    await chapter(step === 5 ? 'Completed instances archive automatically' : `Committed checkpoint ${current.revision}`, step === 5 ? 2500 : 1800);
  }
  await expect(screen.locator('#archive-receipt')).toBeVisible();
  const elapsed = Date.now() - start;
  assert(elapsed < 55000, `Capture took ${elapsed} ms; rerun on an idle machine for a 30–60 second clip.`);
  await screen.waitForTimeout(Math.max(1000, 46000 - elapsed));
  await movie.close(); const videoPath = await video.path();
  const duration = Math.min(55, Math.max(45, Math.ceil(elapsed / 1000) + 1));
  await exec(process.env.FFMPEG_PATH || 'ffmpeg', ['-y', '-ss', String(leadIn), '-i', videoPath, '-t', String(duration), '-vf', 'fps=8,scale=1152:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', join(docs, 'demo.gif')], { timeout: 120000, maxBuffer: 1024 * 1024 });
  assert.deepEqual(errors, []);
  const manifest = { capturedAt: new Date().toISOString(), appVersion: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version, mermaidVersion: JSON.parse(await readFile(join(root, 'node_modules/mermaid/package.json'), 'utf8')).version, viewport: { width: 1536, height: 960 }, language: 'en', screenshots: pictures, demo: { file: 'demo.gif', seconds: duration, width: 1152, fps: 8, chapters }, data: 'Example definitions, sample home, empty discovery fixture. Exported Skill and state transitions run locally; no LLM calls are depicted.' };
  await writeFile(join(docs, 'media-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify(manifest, null, 2));
} finally { if (monitorPid) { try { process.kill(monitorPid); } catch { /* already expired */ } } await browser.close(); }

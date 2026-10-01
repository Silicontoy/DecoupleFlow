import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { strFromU8, unzipSync } from 'fflate';
import { createTemplate } from '../../src/domain/templates';
import { runtime, type RunRecord } from '../../src/domain/runtime';
import { answer, jevResponse } from '../adapter-fixtures';

async function openSimple(page: Page) {
  const project = createTemplate('simple');
  await page.goto('/');
  await page.getByLabel('选择项目文件').setInputFiles({ name: 'simple.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '推进', exact: true }).click();
  await expect(page.getByText('实时连接', { exact: true })).toBeVisible();
  return project;
}
async function instance(page: Page): Promise<RunRecord> {
  return page.evaluate(() => { const w = JSON.parse(localStorage.getItem('decoupleflow.workspace.v1')!); return JSON.parse(localStorage.getItem(`decoupleflow.instance.${w.active}`)!); });
}
async function activeMachine(page: Page) {
  return page.evaluate(() => { const w = JSON.parse(localStorage.getItem('decoupleflow.workspace.v1')!); return w.documents.find((d: { key: string }) => d.key === w.active).project.machine; });
}

test('streams real external events, colors states, pauses, steps and forks an independent run', async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const { machine } = await openSimple(page);
  await expect(page.getByTestId('state-prepare')).toHaveAttribute('data-execution-status', 'active');
  const record = await instance(page); const info = await (await page.request.get('/api/info')).json();
  const opened = await (await page.request.post('/api/runs/open', { headers: { 'X-DecoupleFlow-Token': info.token }, data: { machine, record } })).json();
  const push = async (type: string, detail: string) => page.request.post('/api/runs/event', { headers: { 'X-DecoupleFlow-Run-Token': opened.eventToken }, data: { runId: record.instanceId, expectedRevision: 0, type, detail, actor: 'Test Agent' } });
  expect((await push('agent.started', '开始准备输入')).status()).toBe(200);
  await expect(page.locator('.event-log')).toContainText('agent.started');
  await push('external.waiting', '等待 job-42');
  await expect(page.getByTestId('state-prepare')).toHaveAttribute('data-execution-status', 'waiting');
  await expect(page.locator('.waiting-event')).toContainText('job-42');
  const snapshotResponse = await page.request.post('/api/runs/snapshot', { headers: { 'X-DecoupleFlow-Run-Token': opened.eventToken }, data: { runId: record.instanceId } });
  expect(snapshotResponse.status()).toBe(200); expect((await snapshotResponse.json()).phase).toBe('waiting');
  expect((await page.request.post('/api/install', { headers: { 'X-DecoupleFlow-Run-Token': opened.eventToken }, data: {} })).status()).toBe(403);
  await push('human.required', '需要确认资料');
  await expect(page.getByTestId('state-prepare')).toHaveAttribute('data-execution-status', 'human');
  await push('run.timeout', '外部等待超时');
  await expect(page.getByTestId('state-prepare')).toHaveAttribute('data-execution-status', 'timeout');
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.getByTestId('state-prepare')).toHaveAttribute('data-execution-status', 'paused');
  const id = runtime.candidates(machine, record)[0].id;
  await page.getByLabel('Agent 决策 JSON').fill(JSON.stringify(answer(machine, record, id)));
  await page.getByRole('button', { name: '单步', exact: true }).click();
  await expect(page.getByTestId('state-work')).toHaveAttribute('data-execution-status', 'paused');
  await expect(page.getByTestId('state-prepare')).toHaveAttribute('data-execution-status', 'done');
  await expect(page.locator('.event-log')).toContainText('transition.taken');
  await page.getByRole('button', { name: '从此处分叉', exact: true }).click();
  await expect(page.locator('.event-log')).toContainText('run.forked');
  await expect.poll(async () => (await instance(page)).instanceId).not.toBe(record.instanceId);
  const child = await instance(page); expect(child.instanceId).not.toBe(record.instanceId); expect(child.currentState).toBe('work');
  const parent = await (await page.request.post('/api/runs/open', { headers: { 'X-DecoupleFlow-Token': info.token }, data: { machine, record } })).json();
  expect(parent.snapshot.record.currentState).toBe('work'); expect(parent.snapshot.paused).toBe(true);
  await page.getByRole('button', { name: '注入事件', exact: true }).click();
  await page.getByLabel('运行事件 JSON').fill(JSON.stringify({ type: 'agent.completed', actor: 'My Agent', context: '本次工作成果已完成', detail: '工作已交付' }));
  await page.getByRole('button', { name: '提交事件', exact: true }).click();
  await expect(page.getByLabel('本次执行证据')).toHaveValue('本次工作成果已完成');
  await expect(page.locator('.event-log')).toContainText('My Agent');
  await page.getByRole('button', { name: '继续', exact: true }).click();
  const childInfo = await (await page.request.post('/api/runs/open', { headers: { 'X-DecoupleFlow-Token': info.token }, data: { machine, record: child } })).json();
  const childPath = runtime.candidates(machine, child)[0];
  const completed = await page.request.post('/api/runs/event', { headers: { 'X-DecoupleFlow-Run-Token': childInfo.eventToken }, data: { runId: child.instanceId, expectedRevision: child.revision, type: 'agent.completed', actor: 'My Agent', context: '质量检查通过，可以交付', decision: answer(machine, child, childPath.id) } });
  expect(completed.status()).toBe(200);
  await expect(page.getByTestId('state-done')).toHaveAttribute('data-execution-status', 'active');
  await expect(page.getByTestId('state-work')).toHaveAttribute('data-execution-status', 'done');
  await page.screenshot({ path: testInfo.outputPath('execution-workbench.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('Jev mode persists without the key, visualizes uncertainty and exports its portable adapter', async ({ page }, testInfo) => {
  await openSimple(page);
  await page.locator('.driver-settings>summary').click();
  await page.getByRole('button', { name: /Jev 首个官方 Adapter/ }).click();
  await page.getByLabel('最低置信度', { exact: true }).fill('0.9');
  await page.getByLabel('最低置信度', { exact: true }).blur();
  await expect(page.getByText('已保存在本机', { exact: true })).toBeVisible();
  await expect(page.getByText('实时连接', { exact: true })).toBeVisible();
  await expect(page.getByLabel('最低置信度', { exact: true })).toHaveValue('0.9');
  await page.getByLabel('当前会话 API Key').fill('test-key-not-for-real-api');
  await page.getByLabel('本次执行证据').fill('准备完毕，输入已核实');
  await page.route('**/api/runs/step', async route => {
    const payload = route.request().postDataJSON(); const machine = await activeMachine(page); const record = await instance(page);
    const info = await (await page.request.get('/api/info')).json();
    const { snapshot } = await (await page.request.post('/api/runs/open', { headers: { 'X-DecoupleFlow-Token': info.token }, data: { machine, record } })).json();
    const request = runtime.buildJevRequest(machine, record, payload.context); const id = runtime.candidates(machine, record)[0].id;
    const result = runtime.interpretJev(machine, record, payload.context, jevResponse(request, id, 0.58, 0.61), record.definitionHash);
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ...snapshot, phase: 'human', result, record: result.record }) });
  });
  await page.getByRole('button', { name: 'Jev 判断并推进', exact: true }).click();
  await expect(page.locator('.probability-row').first()).toContainText('0.58');
  await expect(page.locator('.failed-conditions')).toContainText('低于设定阈值');
  await expect(page.getByTestId('state-prepare')).toHaveAttribute('data-execution-status', 'human');
  await page.screenshot({ path: testInfo.outputPath('jev-decision.png'), fullPage: true });
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-key-not-for-real-api');
  await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'adapter.mjs', exact: true })).toBeVisible();
  const downloadEvent = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载 ZIP', exact: true }).click();
  const files = unzipSync(await readFile((await (await downloadEvent).path())!));
  const content = Object.values(files).map(value => strFromU8(value)).join('\n'); expect(content).not.toContain('test-key-not-for-real-api');
  const adapter = Object.entries(files).find(([path]) => path.endsWith('/scripts/adapter.mjs'))![1];
  const source = strFromU8(adapter).replace('export { runtime };', '').replace('export const requestJev', 'const requestJev');
  const exported = runInNewContext(source + '\nruntime;'); expect(typeof exported.applyDecision).toBe('function');
});

test('exports runnable workflow projects and a Dify DSL with executable state checks', async ({ page }) => {
  await openSimple(page); await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'LangChain / LangGraph', exact: true }).click();
  await expect(dialog.getByText('LANGGRAPH PROJECT', { exact: true })).toBeVisible();
  await expect(dialog.locator('.code-view')).toContainText('StateGraph');
  const downloadEvent = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载接入包', exact: true }).click();
  const files = unzipSync(await readFile((await (await downloadEvent).path())!));
  expect(Object.keys(files).some(path => path.endsWith('/workflow.mjs'))).toBe(true);
  await dialog.getByRole('button', { name: 'Dify', exact: true }).click();
  await expect(dialog.getByText('单步迁移工作流：', { exact: true })).toBeVisible();
  const yamlEvent = page.waitForEvent('download'); await dialog.getByRole('button', { name: '下载 DSL', exact: true }).click();
  const dsl = JSON.parse(await readFile((await (await yamlEvent).path())!, 'utf8'));
  const code = dsl.workflow.graph.nodes.find((n: { id: string }) => n.id === 'df-advance').data.code;
  const main = runInNewContext(code + '\nmain;'); const result = main({ record_json: '', context: '新任务', decision_json: '' });
  expect(result.current_state).toBe('prepare'); expect(result.status).toBe('held');
});

test('archives a completed instance and starts a new one on re-entry while preserving the archive', async ({ page }) => {
  const { machine } = await openSimple(page); const first = await instance(page);
  for (let i = 0; i < 3; i++) {
    const record = await instance(page);
    await page.getByLabel('Agent 决策 JSON').fill(JSON.stringify(answer(machine, record, runtime.candidates(machine, record)[0].id)));
    await page.getByRole('button', { name: '应用 Agent 决策', exact: true }).click();
    if (i < 2) await expect.poll(async () => (await instance(page)).revision).toBe(i + 1);
  }
  await expect(page.locator('.instance-receipt')).toContainText('活动位置已释放');
  const read = () => page.evaluate(() => { const w = JSON.parse(localStorage.getItem('decoupleflow.workspace.v1')!); const key = `decoupleflow.instance.${w.active}`; return { active: localStorage.getItem(key), archives: JSON.parse(localStorage.getItem(key + '.archives') || '[]') }; });
  await expect.poll(async () => (await read()).active).toBeNull();
  expect((await read()).archives[0].record.instanceId).toBe(first.instanceId);
  await page.getByRole('button', { name: '状态机', exact: true }).click();
  await page.getByRole('button', { name: '推进', exact: true }).click();
  await expect(page.getByText('实时连接', { exact: true })).toBeVisible();
  expect((await instance(page)).instanceId).not.toBe(first.instanceId); expect((await instance(page)).currentState).toBe('prepare');
  await page.locator('.instance-archives summary').click();
  await page.getByRole('button', { name: '查看记录', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('run.archived');
  await expect(page.getByRole('dialog').getByRole('button', { name: '继续', exact: true })).toBeDisabled();
});

test('defaults Skill installation to personal scope and never preselects the service project', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '导出 / 接入', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: '个人目录（默认）', exact: true })).toHaveClass('active');
  await expect(dialog.getByLabel('Agent 用户主目录')).toBeVisible();
  await dialog.getByRole('button', { name: '指定项目', exact: true }).click();
  await expect(dialog.getByLabel('项目目录', { exact: true })).toHaveValue('');
  await expect(dialog.getByRole('button', { name: '安装到 Agent', exact: true })).toBeDisabled();
});

import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { strFromU8, unzipSync } from 'fflate';
import { createDemo, DEMO_IDS } from '../../src/domain/demos';

test.use({ storageState: { cookies: [], origins: [] } });

for (const id of DEMO_IDS) test(`${id} demo is discoverable, renders its full diagram, and exports a usable Skill`, async ({ page }, testInfo) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/agents/directories', route => route.fulfill({ json: { projects: [], profiles: [], notes: [], scannedAt: new Date().toISOString() } }));
  const { machine } = createDemo(id, 'en');
  await page.goto('/');
  await page.getByRole('button', { name: 'New machine', exact: true }).click();
  const templates = page.getByRole('dialog');
  await expect(templates.locator('.template-card').filter({ hasText: 'DEMO' })).toHaveCount(3);
  await templates.getByRole('button', { name: new RegExp(machine.name) }).click();
  await expect(page.getByRole('heading', { name: machine.name, exact: true })).toBeVisible();
  await expect(page.locator('.react-flow__node')).toHaveCount(machine.states.length);
  await page.getByRole('button', { name: 'Description', exact: true }).click();
  const diagram = page.getByTestId('state-diagram');
  await expect(diagram.locator('svg')).toBeVisible();
  for (const state of machine.states) await expect(diagram).toContainText(state.name);
  await page.getByRole('button', { name: 'Export / Connect', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download ZIP', exact: true }).click();
  const zip = unzipSync(await readFile((await (await downloading).path())!));
  const definitionPath = Object.keys(zip).find(path => path.endsWith('/references/state-machine.json'))!;
  expect(definitionPath).toMatch(/^\.agents\/skills\/df-demo-/);
  const definition = JSON.parse(strFromU8(zip[definitionPath]));
  expect(definition.states).toHaveLength(machine.states.length);
  expect(definition.transitions).toHaveLength(machine.transitions.length);
  expect(definition.states.find((state: { kind: string }) => state.kind === 'list').list.passCondition).toBeTruthy();
  await dialog.locator('.export-route-tabs').getByRole('button', { name: 'Markdown', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Copy Mermaid', exact: true })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath(`${id}-export.png`), fullPage: true });
  expect(errors).toEqual([]);
});

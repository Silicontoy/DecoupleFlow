import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createTemplate } from '../../src/domain/templates';
import { compileMarkdown } from '../../src/domain/compiler';
import { compileStateDiagram } from '../../src/domain/diagram';

const routes = ['Agent Skill', 'LangChain / LangGraph', 'Dify', 'Markdown'];
async function mockDirectories(page: Page) {
  let scans = 0;
  await page.route('**/api/agents/directories', route => { scans++; return route.fulfill({ json: { projects: [], profiles: [], notes: [], scannedAt: new Date().toISOString() } }); });
  return () => scans;
}
async function geometry(page: Page) {
  return page.evaluate(() => Object.fromEntries(['.export-modal', '.export-route-tabs', '.export-content', '.export-modal > .modal-footer'].map(selector => {
    const rect = document.querySelector(selector)!.getBoundingClientRect();
    return [selector, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
  })));
}

for (const language of ['zh', 'en'] as const) {
  test(`keeps the export shell and controls in place while switching all four routes (${language})`, async ({ page }, testInfo) => {
    const scans = await mockDirectories(page);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.getByLabel('Language', { exact: true }).selectOption(language);
    await page.getByRole('button', { name: language === 'zh' ? '导出 / 接入' : 'Export / Connect', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); element.setAttribute('data-shell-retained', 'yes'); });
    const tabs = dialog.locator('.export-route-tabs');
    await expect(tabs.locator(':scope > button')).toHaveText(routes);
    const before = await geometry(page);
    for (const route of [...routes.slice(1), ...routes]) {
      const button = tabs.getByRole('button', { name: route, exact: true });
      await button.click();
      await expect(button).toBeFocused();
      await expect(dialog).toHaveAttribute('data-shell-retained', 'yes');
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      // Sample the first paint as well as the compiled preview: neither may move the shell.
      for (let frame = 0; frame < 3; frame++) {
        const after = await geometry(page);
        for (const [selector, rect] of Object.entries(before)) for (const key of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(after[selector][key] - rect[key]), `${route}: ${selector}.${key}`).toBeLessThan(1);
        await page.evaluate(() => new Promise(requestAnimationFrame));
      }
      await expect(dialog.locator('.code-view pre')).not.toBeEmpty();
      if (language === 'en') await page.screenshot({ path: testInfo.outputPath(`export-${route === 'LangChain / LangGraph' ? 'langgraph' : route.toLowerCase().replaceAll(' ', '-')}.png`), fullPage: true });
    }
    expect(scans()).toBe(1);
    expect(errors).toEqual([]);
  });
}

test('copies the complete Markdown and fenced Mermaid definition, follows language, and downloads the same document', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await mockDirectories(page);
  const project = createTemplate('loop');
  project.machine.name = '保留原文 $& {0}';
  project.machine.states[0].description = '步骤内容保持原样 <tag> $& {1}';
  await page.goto('/');
  await page.getByLabel('选择项目文件').setInputFiles({ name: 'loop.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) });
  const dialog = page.getByRole('dialog');
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  for (const language of ['zh', 'en'] as const) {
    if (await dialog.count()) await page.keyboard.press('Escape');
    await page.getByLabel('Language', { exact: true }).selectOption(language);
    await page.getByRole('button', { name: language === 'zh' ? '导出 / 接入' : 'Export / Connect', exact: true }).click();
    await expect(dialog.getByLabel('Language', { exact: true })).toHaveCount(0);
    await dialog.locator('.export-route-tabs').getByRole('button', { name: 'Markdown', exact: true }).click();
    const markdown = compileMarkdown(project.machine, language);
    const mermaid = ['```mermaid', compileStateDiagram(project.machine, language).trimEnd(), '```', ''].join('\n');
    await dialog.getByRole('button', { name: language === 'zh' ? '复制 Markdown' : 'Copy Markdown', exact: true }).click();
    expect(await clipboard()).toBe(markdown);
    await dialog.getByRole('button', { name: language === 'zh' ? '复制 Mermaid' : 'Copy Mermaid', exact: true }).click();
    expect(await clipboard()).toBe(mermaid);
    await dialog.getByRole('button', { name: language === 'zh' ? /Mermaid 代码块/ : /Mermaid code block/ }).click();
    expect(await dialog.locator('.markdown-export-code pre').textContent()).toBe(mermaid);
    for (const transition of project.machine.transitions) expect(mermaid).toContain(`${transition.id} · `);
    expect(markdown).toContain(mermaid.trimEnd());
    const downloading = page.waitForEvent('download');
    await dialog.getByRole('button', { name: language === 'zh' ? '下载 Markdown' : 'Download Markdown', exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe(`${project.machine.id}.md`);
    expect(await readFile((await download.path())!, 'utf8')).toBe(markdown);
  }
  // The other route actions always copy the currently selected route's content.
  const tabs = dialog.locator('.export-route-tabs');
  await tabs.getByRole('button', { name: 'LangChain / LangGraph', exact: true }).click();
  await dialog.getByRole('button', { name: 'Copy command', exact: true }).click();
  expect(await clipboard()).toBe('npm install && npm start');
  await tabs.getByRole('button', { name: 'Dify', exact: true }).click();
  await dialog.getByRole('button', { name: 'Copy DSL', exact: true }).click();
  const dsl = await clipboard();
  expect(JSON.parse(dsl).workflow.graph.nodes.some((node: { id: string }) => node.id === 'df-advance')).toBe(true);
  const downloading = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Download DSL', exact: true }).click();
  expect(await readFile((await (await downloading).path())!, 'utf8')).toBe(dsl);
});

test('keeps route tabs, quick copy, and download buttons accessible on a narrow screen', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockDirectories(page);
  await page.goto('/');
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await page.getByRole('button', { name: 'Export / Connect', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
  const before = await geometry(page);
  for (const route of routes) {
    await dialog.locator('.export-route-tabs').getByRole('button', { name: route, exact: true }).click();
    const after = await geometry(page);
    for (const selector of ['.export-modal', '.export-route-tabs', '.export-content', '.export-modal > .modal-footer']) expect(after[selector]).toEqual(before[selector]);
    for (const button of await dialog.locator('.export-route-tabs > button, .export-route-actions button, .modal-footer button').all()) {
      const rect = await button.boundingBox();
      expect(rect!.x).toBeGreaterThanOrEqual(0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(390);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(844);
    }
  }
  await page.screenshot({ path: testInfo.outputPath('export-markdown-mobile.png'), fullPage: true });
});

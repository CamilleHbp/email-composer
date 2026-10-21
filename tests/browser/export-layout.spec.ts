import { test, expect } from '@playwright/test';
import { blank, node } from '../../shared/model';
import { renderEmail } from '../../shared/render';
import { compile } from '../../server/email';
import { build } from 'esbuild';

function newsletter() {
  const doc = blank();
  doc.width = 600;
  doc.paddingSides = [24, 0, 24, 0];
  const section = node('section');
  section.style.paddingSides = [34, 32, 34, 32];
  section.style.background = '#fff9e8';
  const text = node('text', 'https://example.test/a-long-survey-link-that-must-wrap-within-the-email-container-1731945425');
  const row = node('row');
  row.style.paddingSides = [24, 12, 24, 12];
  row.style.gap = 16;
  row.children = [node('column')];
  row.children[0].style.width = 100;
  row.children[0].style.paddingSides = [26, 26, 26, 26];
  row.children[0].style.background = '#ffdaad';
  const poster = node('image');
  poster.style.padding = 0;
  poster.style.imageWidth = 600;
  poster.style.marginSides = [0, 8, 0, 8];
  poster.style.border = 2;
  poster.remoteSrc = 'https://example.test/poster.png';
  poster.alt = 'Survey poster';
  row.children[0].children = [poster];
  const logo = node('image');
  logo.style.padding = 0;
  logo.style.imageWidth = 66;
  logo.remoteSrc = 'https://example.test/logo.png';
  logo.alt = 'Footer logo';
  const footer = node('row');
  footer.style.gap = 12;
  footer.children[0].style.width = 18;
  footer.children[1].style.width = 82;
  footer.children.forEach(column => { column.style.padding = 0; });
  footer.children[0].children = [logo];
  footer.children[1].children = [node('text', 'Thank you for reading!\nSee you at the cinema.')];
  section.children = [node('heading', 'Why go to the cinema?'), text, row, footer];
  doc.nodes = [section];
  return doc;
}

test.beforeEach(async ({ context }) => {
  await context.route('https://example.test/**', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="480"><rect width="1200" height="480" fill="#537daa"/></svg>',
  }));
});

test('large images and long links stay inside nested email layouts in preview and exports', async ({ page }) => {
  const doc = newsletter();
  const copy = renderEmail(doc, { assets: {}, clipboard: true }).fragment;
  const html = (await compile(doc, {})).html;
  for (const width of [900, 600, 375, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const output of [copy, copy.replace(/<style[^>]*>[\s\S]*?<\/style>/g, ''), html]) {
      await page.setContent(output === html ? html : `<body style="margin:0">${output}</body>`);
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      const poster = page.getByAltText('Survey poster');
      const box = await poster.boundingBox();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.width).toBeLessThanOrEqual(460);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width - 32);
      expect(box!.height / box!.width).toBeCloseTo(0.4, 2);
      await expect(page.getByAltText('Footer logo')).toHaveCSS('width', '66px');
    }
  }
});

test('image width remains bounded when a mail client ignores image max-width', async ({ page }) => {
  const doc = newsletter();
  await page.setViewportSize({ width: 600, height: 1000 });
  await page.setContent(`<body style="margin:0">${renderEmail(doc, { assets: {}, clipboard: true }).fragment}</body>`);
  await page.addStyleTag({ content: 'img { max-width: none !important; }' });
  const poster = await page.getByAltText('Survey poster').boundingBox();
  expect(poster!.x + poster!.width).toBeLessThanOrEqual(600 - 32);
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 600);
});

test('Proton Mail editor preserves the exported layout on paste', async ({ page, context }) => {
  // Proton's declared Rooster version and paste options:
  // https://github.com/ProtonMail/WebClients/blob/main/packages/components/package.json
  // https://github.com/ProtonMail/WebClients/blob/main/packages/components/components/editor/rooster/plugins/EditorCustomPastePlugin.ts
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const bundle = await build({ stdin: { contents: `
    import { Editor, Paste, PluginEventType } from 'roosterjs';
    new Editor(document.querySelector('[contenteditable]'), { defaultFormat: { fontFamily: 'Arial', fontSize: '14px', textColor: '#000000', backgroundColor: '#FFFFFF' }, plugins: [new Paste(), {
      getName: () => 'ProtonPasteOptions', initialize() {}, dispose() {},
      onPluginEvent(event) {
        if (event.eventType === PluginEventType.BeforePaste) {
          event.sanitizingOption.additionalAllowedAttributes = ['bgcolor'];
          event.sanitizingOption.additionalTagReplacements = { INPUT: null, TEXTAREA: null, FORM: null };
        }
      }
    }] });`, resolveDir: process.cwd() }, bundle: true, write: false, platform: 'browser' });
  await page.route('**/proton-paste-check', route => route.fulfill({
    // Proton's composer iframe uses quirks mode with a 14px font and 1.5 line height.
    contentType: 'text/html', body: '<body style="margin:0;font:14px/1.5 Arial"><div contenteditable="true"></div></body>',
  }));
  await page.setViewportSize({ width: 600, height: 1000 });
  await page.goto('/proton-paste-check');
  const fragment = renderEmail(newsletter(), { assets: {}, clipboard: true }).fragment;
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(async html => navigator.clipboard.write([new ClipboardItem({
    'text/html': new Blob([html], { type: 'text/html' }),
  })]), fragment);
  await page.locator('[contenteditable]').focus();
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.getByAltText('Survey poster')).toBeVisible();
  const preview = await context.newPage();
  for (const width of [600, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await preview.setViewportSize({ width, height: 1000 });
    await preview.setContent(`<!doctype html><body style="margin:0">${fragment}</body>`);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
    const geometry = (images: HTMLImageElement[]) => images.map(image => {
      const r = image.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    expect(await page.locator('img').evaluateAll(geometry)).toEqual(await preview.locator('img').evaluateAll(geometry));
  }
  await preview.close();
});

test('editable canvas, preview and clipboard paste share the image layout at desktop and mobile widths', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await page.getByLabel('Email address').fill('test@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password-12345');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create an email', exact: true })).toBeVisible();
  const response = await page.request.post('/api/templates', {
    data: { name: 'Image export regression', kind: 'template', document: newsletter() },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Open Image export regression', exact: true }).click();
  const canvasLayouts = new Map<number, { x: number; y: number; width: number; height: number }[]>();
  for (const width of [900, 600, 375]) {
    await page.getByRole('spinbutton', { name: 'Preview width', exact: true }).fill(String(width));
    canvasLayouts.set(width, await page.locator('.email-canvas img').evaluateAll(images => images.map(image => {
      const canvas = image.closest('.email-canvas')!.getBoundingClientRect();
      const rect = image.getBoundingClientRect();
      return { x: rect.x - canvas.x, y: rect.y - canvas.y, width: rect.width, height: rect.height };
    })));
  }
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await page.getByRole('button', { name: /^Copy (?:formatted )?email$/ }).click();
  await expect(page.getByText(/^Email copied\./)).toBeVisible();

  const recipient = await context.newPage();
  await recipient.route('**/paste-layout-test', route => route.fulfill({
    contentType: 'text/html', body: '<body style="margin:0"><div contenteditable="true"></div></body>',
  }));
  await recipient.goto('/paste-layout-test');
  await recipient.locator('[contenteditable]').focus();
  await recipient.keyboard.press('ControlOrMeta+v');
  await expect(recipient.getByAltText('Survey poster')).toBeVisible();
  for (const width of [900, 600, 375]) {
    await page.getByRole('dialog').getByRole('spinbutton', { name: 'Preview width', exact: true }).fill(String(width));
    await recipient.setViewportSize({ width, height: 1000 });
    const previewBody = page.frameLocator('iframe').locator('body');
    await expect(previewBody).toHaveJSProperty('scrollWidth', width);
    await expect(recipient.locator('body')).toHaveJSProperty('scrollWidth', width);
    const dimensions = (elements: HTMLElement[]) => elements.map(image => {
      const rect = image.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    expect(await recipient.locator('img').evaluateAll(dimensions)).toEqual(await previewBody.locator('img').evaluateAll(dimensions));
    const previewLayout = await previewBody.locator('img').evaluateAll(dimensions);
    const canvasLayout = canvasLayouts.get(width)!;
    for (let i = 0; i < previewLayout.length; i++) {
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(canvasLayout[i][key] - previewLayout[i][key]), `${width}px image ${i} ${key}`).toBeLessThanOrEqual(1);
      }
    }
  }
  await recipient.close();
});

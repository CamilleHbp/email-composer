import { test, expect } from '@playwright/test';
import { blank, node } from '../../shared/model';
import { renderEmail } from '../../shared/render';

test('clipboard columns and their images stay centered after wrapping without stylesheets', async ({ page }) => {
  const doc = blank();
  doc.width = 600;
  doc.paddingSides = [0, 0, 0, 0];
  const row = node('row');
  row.style.align = 'center';
  row.style.gap = 24;
  row.children.forEach((column, index) => {
    column.style.padding = 0;
    column.style.width = index === 0 ? 60 : 40;
    const image = node('image');
    image.remoteSrc = 'https://example.test/poster.png';
    image.alt = `Poster ${index}`;
    image.style.align = 'center';
    image.style.imageWidth = 100;
    image.style.padding = 0;
    column.children = [image];
  });
  doc.nodes = [row];
  const fragment = renderEmail(doc, { assets: {}, clipboard: true }).fragment.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
  for (const width of [600, 375, 300]) {
    await page.setViewportSize({ width, height: 800 });
    await page.setContent(`<body style="margin:0">${fragment}</body>`);
    const images = await page.locator('img').evaluateAll(elements => elements.map(el => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width };
    }));
    if (width === 600) expect(images[0].y).toBe(images[1].y);
    else {
      for (const image of images) expect(Math.abs(image.x + image.width / 2 - width / 2)).toBeLessThan(1);
      expect(images[1].y).toBeGreaterThan(images[0].y);
    }
  }
});

test('desktop columns fit when a mail client strips negative margins', async ({ page }) => {
  const doc = blank();
  doc.width = 600;
  doc.paddingSides = [24, 0, 24, 0];
  const section = node('section');
  section.style.paddingSides = [34, 32, 34, 32];
  const row = node('row');
  row.style.padding = 0;
  row.style.gap = 24;
  row.style.align = 'center';
  row.children.forEach((column, index) => {
    column.style.width = index === 0 ? 42 : 65;
    column.style.vertical = 'top';
    column.children = [node('text', index === 0 ? 'Poster column' : 'Film description')];
  });
  section.children = [row];
  doc.nodes = [section];
  const fragment = renderEmail(doc, { assets: {}, clipboard: true }).fragment;
  // Some mail sanitizers discard negative margins. Simulate the received HTML.
  const sanitized = fragment.replace(/margin:0 -[\d.]+px;/g, '').replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
  for (const width of [1000, 600, 375]) {
    await page.setViewportSize({ width, height: 800 });
    await page.setContent(`<body style="margin:0">${sanitized}</body>`);
    const poster = (await page.getByText('Poster column', { exact: true }).boundingBox())!;
    const description = (await page.getByText('Film description', { exact: true }).boundingBox())!;
    if (width >= 600) {
      expect(description.y).toBe(poster.y);
      expect(description.x).toBeGreaterThanOrEqual(poster.x + poster.width);
    } else expect(description.y).toBeGreaterThan(poster.y);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
  }
});

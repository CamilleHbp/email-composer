import { test, expect } from '@playwright/test';
import { blank, node } from '../../shared/model';

test('columns honor independent vertical alignment and stretch when stacked', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill('test@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password-12345');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create an email', exact: true })).toBeVisible();
  const document = blank();
  const row = node('row');
  row.children = ['top', 'middle', 'bottom'].map((vertical, index) => {
    const column = node('column');
    column.style.vertical = vertical as 'top' | 'middle' | 'bottom';
    column.style.padding = 0;
    const spacer = node('spacer');
    spacer.style.padding = 0;
    spacer.style.height = index === 0 ? 240 : 60;
    column.children = [spacer];
    return column;
  });
  document.nodes[0].children = [row];
  const response = await page.request.post('/api/templates', {
    data: { name: 'Column alignment regression', kind: 'template', document },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Open Column alignment regression', exact: true }).click();
  const columns = page.locator(`[data-node-id="${row.id}"] > .kind-column`);
  const bounds = () => columns.evaluateAll(items => items.map(el => {
    const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
  }));
  let rects = await bounds();
  expect(Math.abs((rects[1].top + rects[1].bottom) / 2 - (rects[0].top + rects[0].bottom) / 2)).toBeLessThan(1);
  expect(Math.abs(rects[2].bottom - rects[0].bottom)).toBeLessThan(1);
  expect(rects[1].top).toBeGreaterThan(rects[0].top + 50);
  expect(rects[2].top).toBeGreaterThan(rects[1].top + 50);
  await columns.nth(2).locator(':scope > .node-handle').dispatchEvent('click');
  await page.getByRole('combobox', { name: 'Vertical alignment', exact: true }).selectOption('top');
  rects = await bounds();
  expect(Math.abs(rects[2].top - rects[0].top)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Mobile', exact: true }).click();
  rects = await bounds();
  expect(rects[1].top).toBeGreaterThanOrEqual(rects[0].bottom);
  expect(rects[2].top).toBeGreaterThanOrEqual(rects[1].bottom);
  expect(rects.map(r => r.width)).toEqual([rects[0].width, rects[0].width, rects[0].width]);
});

import { test, expect } from '@playwright/test';
import { blank, node } from '../../shared/model';

test('desktop viewport stays above imported mobile breakpoints', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email address').fill('test@example.test');
  await page.getByLabel('Password', { exact: true }).fill('test-password-12345');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Create an email', exact: true })).toBeVisible();
  const document = blank();
  document.width = 600;
  const row = node('row');
  row.style.mobileBreakpoint = 600;
  const text = node('text', 'Desktop-only content');
  text.style.hiddenOnMobile = true;
  text.style.mobileBreakpoint = 600;
  row.children[0].children = [text];
  row.children[1].children = [node('text', 'Second column')];
  document.nodes[0].children = [row];
  const response = await page.request.post('/api/templates', {
    data: { name: 'Imported breakpoint regression', kind: 'template', document },
    headers: { Origin: new URL(page.url()).origin },
  });
  expect(response.ok()).toBe(true);
  await page.reload();
  await page.getByRole('button', { name: 'Open Imported breakpoint regression', exact: true }).click();
  const columns = page.locator(`[data-node-id="${row.id}"]`);
  const desktopText = page.locator(`[data-node-id="${text.id}"]`);
  const width = page.getByRole('spinbutton', { name: 'Preview width', exact: true });
  await expect(width).toHaveValue('601');
  await expect(columns).toHaveCSS('flex-direction', 'row');
  await expect(desktopText).toBeVisible();
  await expect(page.locator('.email-canvas')).toHaveCSS('width', '601px');
  await width.fill('900');
  await expect(page.locator('.email-canvas')).toHaveCSS('width', '900px');
  await expect(page.getByRole('button', { name: 'Desktop', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await width.fill('600');
  await expect(page.getByRole('button', { name: 'Mobile', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(columns).toHaveCSS('flex-direction', 'column');
  await expect(desktopText).toBeHidden();
  await page.getByRole('button', { name: 'Desktop', exact: true }).click();
  await expect(columns).toHaveCSS('flex-direction', 'row');
  await expect(desktopText).toBeVisible();
  await page.getByRole('button', { name: 'Mobile', exact: true }).click();
  await expect(columns).toHaveCSS('flex-direction', 'column');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Desktop', exact: true }).click();
  await expect(dialog.getByRole('spinbutton', { name: 'Preview width', exact: true })).toHaveValue('601');
  await expect(dialog.locator('iframe')).toHaveCSS('width', '601px');
  await expect(dialog.frameLocator('iframe').getByText('Desktop-only content')).toBeVisible();
});

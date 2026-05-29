import { test, expect } from '@playwright/test';

const PW = 'e2e-master-pass-123';

/**
 * Phase 7 happy path (CLAUDE.md §8): create master password → seed a client's
 * controls → set a control Implemented → add link + file evidence → reload →
 * state persisted → lock → unlock → state still there → wrong password rejected.
 */
test('create → edit → evidence → persist → lock/unlock → wrong password', async ({ page }) => {
  // ---- First run: create master password ----
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Create master password' })).toBeVisible();
  await page.getByLabel('Master password').fill(PW);
  await page.getByLabel('Confirm password').fill(PW);
  await page.getByRole('button', { name: 'Create and unlock' }).click();

  // ---- Empty state → create first engagement (seeds 93 controls) ----
  await page.getByRole('button', { name: /Add first engagement/i }).click();
  await page.getByLabel('Client name').fill('E2E Engagement');
  await page.getByRole('button', { name: 'Create engagement' }).click();
  await expect(page.getByRole('button', { name: 'Switch client engagement' })).toContainText(
    'E2E Engagement',
  );

  // ---- Controls table ----
  await page.getByRole('link', { name: 'Controls' }).click();
  const row = page.getByRole('row', { name: /Policies for information security/ });
  await expect(row).toBeVisible();
  await row.click();

  // ---- Drawer opens ----
  const drawer = page.getByRole('dialog', { name: /Policies for information security/ });
  await expect(drawer).toBeVisible();

  // ---- Set status → Implemented ----
  await drawer.locator('#status-select').click();
  await page.getByRole('option', { name: 'Implemented' }).click();
  // Confirm the selection registered before saving.
  await expect(drawer.getByRole('combobox', { name: 'Implementation status' })).toContainText(
    'Implemented',
  );
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Control updated.')).toBeVisible();

  // ---- Evidence: add a link ----
  await drawer.getByRole('button', { name: 'Link', exact: true }).click();
  await drawer.getByPlaceholder('Label').fill('Security policy');
  await drawer.getByPlaceholder('https://...').fill('https://example.com/policy');
  await drawer.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(drawer.getByText('Security policy')).toBeVisible();

  // ---- Evidence: upload a file (stored inside the encrypted DB) ----
  await drawer.getByRole('button', { name: 'File', exact: true }).click();
  await drawer.getByLabel('Select file to upload').setInputFiles({
    name: 'approval.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('e2e-evidence-file-bytes'),
  });
  await drawer.getByRole('button', { name: 'Upload', exact: true }).click();
  await expect(drawer.getByText('approval.txt')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  // ---- Reload → state persisted ----
  await page.reload();
  await page.getByRole('link', { name: 'Controls' }).click();
  await expect(
    page.getByRole('row', { name: /Policies for information security/ }).getByText('Implemented'),
  ).toBeVisible();

  // ---- Lock ----
  await page.getByRole('button', { name: 'Lock and log out' }).click();
  await expect(page.getByRole('button', { name: 'Unlock' })).toBeVisible();

  // ---- Wrong password is rejected ----
  await page.getByLabel('Master password').fill('totally-wrong-password');
  await page.getByRole('button', { name: 'Unlock' }).click();
  await expect(page.getByText('Incorrect password.')).toBeVisible();

  // ---- Correct password → data still present ----
  await page.getByLabel('Master password').fill(PW);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('link', { name: 'Controls' }).click();
  const implementedRow = page.getByRole('row', { name: /Policies for information security/ });
  await expect(implementedRow.getByText('Implemented')).toBeVisible();

  // ---- Evidence survived too ----
  await implementedRow.click();
  const drawer2 = page.getByRole('dialog', { name: /Policies for information security/ });
  await expect(drawer2.getByText('Security policy')).toBeVisible();
  await expect(drawer2.getByText('approval.txt')).toBeVisible();
});

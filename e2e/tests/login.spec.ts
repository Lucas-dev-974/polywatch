import { test, expect } from '@playwright/test';

test('login page renders and accepts credentials', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Polywatch' })).toBeVisible();
  await page.getByPlaceholder('Utilisateur').fill('admin');
  await page.getByPlaceholder('Mot de passe').fill('changeme');
  await page.getByRole('button', { name: 'Connexion' }).click();
  await expect(page.getByRole('heading', { name: 'Polywatch' }).first()).toBeVisible();
  await expect(page.getByText('Watchlist')).toBeVisible();
});

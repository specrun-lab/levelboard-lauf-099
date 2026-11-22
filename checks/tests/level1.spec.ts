import { expect, test } from '@playwright/test';

test.describe('level-1', () => {
  test('Seite antwortet mit HTTP 200', async ({ request }) => {
    const response = await request.get('/');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
  });

  test('Titel ist „Levelboard“', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle('Levelboard');
  });

  test('10 Level-Karten sichtbar', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).not.toHaveAttribute('data-state', 'loading');
    const cards = page.getByTestId('level-card');
    await expect(cards).toHaveCount(10);
    for (let i = 0; i < 10; i += 1) {
      await expect(cards.nth(i)).toBeVisible();
    }
  });

  test('Keine Konsolenfehler', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await expect(page.getByTestId('board')).not.toHaveAttribute('data-state', 'loading');
    expect(errors).toEqual([]);
  });

  test('Handy-Ansicht: Karten einspaltig', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.getByTestId('board')).not.toHaveAttribute('data-state', 'loading');
    const positions = await page.getByTestId('level-card').evaluateAll((elements) =>
      elements.map((element) => Math.round(element.getBoundingClientRect().x)),
    );
    expect(new Set(positions).size).toBe(1);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
  });
});

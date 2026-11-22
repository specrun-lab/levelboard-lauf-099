import { expect, request as playwrightRequest, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const apiBase = process.env.API_URL || 'http://127.0.0.1:8081';

test.describe('level-5', () => {
  test.describe.configure({ mode: 'serial' });
  let direct: APIRequestContext;

  test.beforeAll(async () => {
    direct = await playwrightRequest.newContext({ baseURL: apiBase });
  });

  test.afterAll(async () => {
    await direct.dispose();
  });

  test('Seite liest aus dem Backend', async ({ page, request }) => {
    const config = await request.get('/config.json');
    expect(config.status()).toBe(200);
    expect(await config.json()).toEqual({ source: 'api' });

    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('run-source')).toHaveAttribute('data-source', 'api');
    await expect(page.getByTestId('run-source')).toHaveText('Backend');
  });

  test('nginx leitet /api/ an das Backend weiter', async ({ request }) => {
    const viaNginx = await request.get('/api/health');
    expect(viaNginx.status()).toBe(200);
    expect(viaNginx.headers()['content-type']).toBe('application/json');

    const directResponse = await direct.get('/api/health');
    expect(directResponse.status()).toBe(200);
    expect(await viaNginx.json()).toEqual(await directResponse.json());

    const unknown = await request.get('/api/unbekannt');
    expect(unknown.status()).toBe(404);
    expect((await unknown.json()).error).toBeTruthy();
  });

  test('Gemeldetes Ergebnis erscheint ohne Neuladen', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');

    const response = await request.post('/api/levels/1/result', {
      data: { checks: [{ name: 'Live-Probe', ok: true }], durationMs: 4242 },
    });
    expect(response.status()).toBe(200);

    const firstCard = page.getByTestId('level-card').first();
    await expect(firstCard).toHaveAttribute('data-status', 'bestanden', { timeout: 8000 });
    await expect(firstCard.getByTestId('level-duration')).toHaveText('4,2 s', { timeout: 8000 });
  });

  test('Backend-Ausfall wird angezeigt', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');

    await page.route('**/api/levels', async (route) => {
      await route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' });
    });

    const notice = page.getByTestId('notice');
    await expect(notice).toHaveAttribute('data-kind', 'unavailable', { timeout: 8000 });
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'unavailable');
    await expect(page.getByTestId('level-card')).toHaveCount(10);
    for (let i = 0; i < 10; i += 1) {
      await expect(page.getByTestId('level-card').nth(i)).toHaveAttribute('data-status', 'offen');
    }

    await page.unroute('**/api/levels');
    await expect(notice).toHaveCount(0, { timeout: 8000 });
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok', { timeout: 8000 });
  });

  test('Meldungen über nginx landen in der Historie', async ({ request }) => {
    const report = {
      checks: [{ name: 'Probe über nginx', ok: true }],
      durationMs: 5151,
    };
    const response = await request.post('/api/levels/1/result', { data: report });
    expect(response.status()).toBe(200);

    const history = await request.get('/api/levels/1/history?limit=1');
    expect(history.status()).toBe(200);
    const body = await history.json();
    expect(body.level).toBe(1);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].status).toBe('bestanden');
    expect(body.entries[0].checks).toEqual(report.checks);
    expect(body.entries[0].durationMs).toBe(5151);
  });
});

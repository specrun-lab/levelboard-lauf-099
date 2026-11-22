import fs from 'node:fs';
import path from 'node:path';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import { loadtest } from '../loadtest.mjs';

const liveUrl = (process.env.LIVE_URL || '').replace(/\/$/, '');
const runId = process.env.RUN_ID || 'lokal';

test.describe('level-9', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Live-Seite zeigt Kopfzeile und 10 Karten', async ({ page }) => {
    expect(liveUrl.startsWith('https://')).toBe(true);
    await page.goto(`${liveUrl}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('run-id')).toHaveText(runId);
    await expect(page.getByTestId('run-commit')).toHaveText(/^[0-9a-f]{7}$/);
    await expect(page.getByTestId('level-card')).toHaveCount(10);
  });

  test('Cache- und gzip-Regeln gelten live', async ({ request }) => {
    const root = await request.get(`${liveUrl}/`, { headers: { 'Accept-Encoding': 'gzip' } });
    expect(root.status()).toBe(200);
    expect(root.headers()['cache-control']).toBe('no-cache');
    expect(root.headers()['content-encoding']).toBe('gzip');

    const html = await root.text();
    const match = html.match(/\/assets\/[^"']+\.js/);
    expect(match, 'JS-Datei in index.html nicht gefunden').toBeTruthy();
    const asset = await request.get(`${liveUrl}${match![0]}`);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');

    const config = await request.get(`${liveUrl}/config.json`);
    expect(config.status()).toBe(200);
    expect(config.headers()['cache-control']).toBe('no-store');

    const missing = await request.get(`${liveUrl}/gibt-es-nicht.json`);
    expect(missing.status()).toBe(404);
  });

  test('Live-API antwortet laut Spec', async () => {
    const api = await playwrightRequest.newContext();
    try {
      const health = await api.get(`${liveUrl}/api/health`);
      expect(health.status()).toBe(200);
      expect(health.headers()['content-type']).toBe('application/json');

      const levels = await api.get(`${liveUrl}/api/levels`);
      expect(levels.status()).toBe(200);
      expect((await levels.json()).levels).toHaveLength(10);

      const unknown = await api.get(`${liveUrl}/api/levels/0`);
      expect(unknown.status()).toBe(404);
      expect((await unknown.json()).error).toBeTruthy();

      const method = await api.fetch(`${liveUrl}/api/levels`, { method: 'DELETE' });
      expect(method.status()).toBe(405);
      expect(method.headers()['allow']).toBe('GET');

      const bad = await api.post(`${liveUrl}/api/levels/1/result`, { data: { checks: [] } });
      expect(bad.status()).toBe(400);

      const badType = await api.post(`${liveUrl}/api/levels/1/result`, {
        headers: { 'Content-Type': 'text/plain' },
        data: '{"checks":[{"name":"x","ok":true}],"durationMs":1}',
      });
      expect(badType.status()).toBe(415);
    } finally {
      await api.dispose();
    }
  });

  test('Meldung erscheint live ohne Neuladen', async ({ page, request }) => {
    await page.goto(`${liveUrl}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const response = await request.post(`${liveUrl}/api/levels/1/result`, {
      data: { checks: [{ name: 'Live-Probe', ok: true }], durationMs: 4242 },
    });
    expect(response.status()).toBe(200);

    await expect(page.getByTestId('level-card').first().getByTestId('level-duration')).toHaveText('4,2 s', {
      timeout: 8000,
    });

    const history = await request.get(`${liveUrl}/api/levels/1/history?limit=1`);
    expect(history.status()).toBe(200);
    const body = await history.json();
    expect(body.entries[0].checks[0].name).toBe('Live-Probe');
  });

  test('Lasttest: 10 Verbindungen, 30 s, ohne Fehler, p95 unter 1 s', async () => {
    test.setTimeout(150_000);
    const result = await loadtest(liveUrl);
    const out = path.resolve(process.cwd(), '.out', 'loadtest.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
    expect(result.requests).toBeGreaterThan(0);
    expect(result.errors).toBe(0);
    expect(result.p95Ms).toBeLessThan(1000);
  });
});

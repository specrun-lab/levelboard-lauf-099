import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { chromium, expect, test } from '@playwright/test';

const projectRoot = path.resolve(process.cwd(), '..');

function compose(args: string[], timeout = 120_000) {
  return execFileSync('docker', ['compose', ...args], {
    cwd: projectRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout,
  });
}

test.describe('container', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Seite läuft im Container und liest aus dem Backend', async ({ request }) => {
    const config = await request.get('/config.json');
    expect(config.status()).toBe(200);
    expect(await config.json()).toEqual({ source: 'api' });

    const page = await request.get('/');
    expect(page.status()).toBe(200);
    const html = await page.text();
    expect(html).toContain('data-testid="board"');

    const browser = await chromium.launch();
    const context = await browser.newContext();
    const p = await context.newPage();
    await p.goto('/');
    await expect(p.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(p.getByTestId('run-source')).toHaveAttribute('data-source', 'api');
    await context.close();
    await browser.close();
  });

  test('/api/ wird an den Backend-Container weitergeleitet', async ({ request }) => {
    const health = await request.get('/api/health');
    expect(health.status()).toBe(200);
    expect(health.headers()['content-type']).toBe('application/json');
    const body = await health.json();
    expect(body.status).toBe('ok');

    const unknown = await request.get('/api/unbekannt');
    expect(unknown.status()).toBe(404);
  });

  test('Meldung erscheint ohne Neuladen', async ({ page, request }) => {
    await page.goto('/');
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    const response = await request.post('/api/levels/1/result', {
      data: { checks: [{ name: 'Probe', ok: true }], durationMs: 4242 },
    });
    expect(response.status()).toBe(200);
    await expect(page.getByTestId('level-card').first().getByTestId('level-duration')).toHaveText('4,2 s', {
      timeout: 8000,
    });
  });

  test('Daten überstehen einen Neustart des Backend-Containers', async ({ request }) => {
    const beforeResponse = await request.get('/api/levels/1/history?limit=500');
    expect(beforeResponse.status()).toBe(200);
    const before = await beforeResponse.json();
    expect(Array.isArray(before.entries)).toBe(true);
    expect(before.entries.length).toBeGreaterThan(0);

    compose(['restart', 'backend'], 120_000);
    const deadline = Date.now() + 60_000;
    for (;;) {
      try {
        const health = await request.get('/api/health');
        if (health.status() === 200) break;
      } catch {
        // Backend startet noch.
      }
      if (Date.now() > deadline) throw new Error('Backend nach Neustart nicht erreichbar');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const afterResponse = await request.get('/api/levels/1/history?limit=500');
    expect(afterResponse.status()).toBe(200);
    expect(await afterResponse.json()).toEqual(before);
  });

  test('Cache- und gzip-Regeln gelten im Container', async ({ request }) => {
    const root = await request.get('/', { headers: { 'Accept-Encoding': 'gzip' } });
    expect(root.status()).toBe(200);
    expect(root.headers()['cache-control']).toBe('no-cache');
    expect(root.headers()['content-encoding']).toBe('gzip');
    expect(root.headers()['server']).toBe('nginx');

    const html = await root.text();
    const match = html.match(/\/assets\/[^"']+\.js/);
    expect(match, 'JS-Datei in index.html nicht gefunden').toBeTruthy();
    const asset = await request.get(match![0]);
    expect(asset.status()).toBe(200);
    expect(asset.headers()['cache-control']).toBe('public, max-age=31536000, immutable');

    const config = await request.get('/config.json');
    expect(config.status()).toBe(200);
    expect(config.headers()['cache-control']).toBe('no-store');

    const missing = await request.get('/gibt-es-nicht.json');
    expect(missing.status()).toBe(404);
  });

  test('Backend-Container läuft nicht als root', () => {
    const uid = compose(['exec', '-T', 'backend', 'id', '-u']).trim();
    expect(uid).not.toBe('0');
  });
});

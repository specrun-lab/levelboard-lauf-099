import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const apiBase = process.env.API_URL || 'http://127.0.0.1:8081';
const projectRoot = path.resolve(process.cwd(), '..');

test.describe('level-3', () => {
  test.describe.configure({ mode: 'serial' });
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: apiBase });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('Backend antwortet auf /api/health', async () => {
    const response = await api.get('/api/health');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('application/json');
    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(typeof body.version).toBe('string');
    expect(body.commit).toBeNull();
  });

  test('GET /api/levels liefert alle 10 Levels im Schema', async () => {
    const response = await api.get('/api/levels');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(['levels', 'run']);
    expect(body.levels).toHaveLength(10);
    for (let i = 0; i < 10; i += 1) {
      expect(body.levels[i].level).toBe(i + 1);
      expect(['offen', 'bestanden', 'fehlgeschlagen', 'gesperrt']).toContain(body.levels[i].status);
      expect(Array.isArray(body.levels[i].checks)).toBe(true);
    }
  });

  test('Ergebnis melden setzt Status und Zeitpunkt', async () => {
    const response = await api.post('/api/levels/1/result', {
      data: { checks: [{ name: 'Probe', ok: true }], durationMs: 10 },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.levels[0].status).toBe('bestanden');
    expect(Number.isNaN(Date.parse(body.levels[0].checkedAt))).toBe(false);
    expect(body.levels[0].durationMs).toBe(10);
  });

  test('Fehlschlag sperrt höhere Levels', async () => {
    const response = await api.post('/api/levels/1/result', {
      data: { checks: [{ name: 'Probe', ok: false }], durationMs: 10 },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.levels[0].status).toBe('fehlgeschlagen');
    for (let i = 1; i < 10; i += 1) {
      expect(body.levels[i].status).toBe('gesperrt');
    }
  });

  test('Falsche Reihenfolge ergibt 409', async () => {
    const response = await api.post('/api/levels/2/result', {
      data: { checks: [{ name: 'Probe', ok: true }], durationMs: 10 },
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).error).toBeTruthy();
  });

  test('Ungültige Anfragen ergeben 400', async () => {
    const bodies = [
      '{kaputt',
      JSON.stringify({ durationMs: 10 }),
      JSON.stringify({ checks: [], durationMs: 10 }),
    ];
    for (const body of bodies) {
      const response = await api.post('/api/levels/1/result', {
        headers: { 'Content-Type': 'application/json' },
        data: body,
      });
      expect(response.status(), body).toBe(400);
      expect((await response.json()).error).toBeTruthy();
    }
  });

  test('Unbekanntes Level ergibt 404', async () => {
    for (const pathName of ['/api/levels/0', '/api/levels/11', '/api/levels/abc']) {
      const response = await api.get(pathName);
      expect(response.status(), pathName).toBe(404);
    }
  });

  test('Go-Tests bestehen', () => {
    expect(() =>
      execFileSync('go', ['test', '-count=1', './...'], {
        cwd: path.join(projectRoot, 'backend'),
        encoding: 'utf8',
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});

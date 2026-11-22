import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, request as playwrightRequest, test } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';

const apiBase = process.env.API_URL || 'http://127.0.0.1:8081';
const projectRoot = path.resolve(process.cwd(), '..');

test.describe('level-4', () => {
  test.describe.configure({ mode: 'serial' });
  let api: APIRequestContext;

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: apiBase });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('Meldungen erscheinen in der Historie, neueste zuerst', async () => {
    for (const durationMs of [101, 102]) {
      const response = await api.post('/api/levels/1/result', {
        data: { checks: [{ name: 'Historie', ok: true }], durationMs },
      });
      expect(response.status()).toBe(200);
    }
    const response = await api.get('/api/levels/1/history');
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.level).toBe(1);
    expect(body.entries.length).toBeGreaterThanOrEqual(2);
    expect(body.entries[0].durationMs).toBe(102);
    expect(body.entries[1].durationMs).toBe(101);
    expect(body.entries[0].status).toBe('bestanden');
    expect(body.entries[0].id).toBeGreaterThan(body.entries[1].id);
  });

  test('Historie begrenzt mit limit', async () => {
    const limited = await api.get('/api/levels/1/history?limit=1');
    expect((await limited.json()).entries).toHaveLength(1);
    for (const value of ['0', '501']) {
      const response = await api.get(`/api/levels/1/history?limit=${value}`);
      expect(response.status(), value).toBe(400);
    }
  });

  test('Daten überstehen einen Neustart des Backends', async () => {
    const beforeHistory = await (await api.get('/api/levels/1/history?limit=500')).json();
    const beforeLevels = await (await api.get('/api/levels')).json();
    execFileSync('make', ['restart-backend'], { cwd: projectRoot, encoding: 'utf8', stdio: 'pipe' });
    await expect.poll(async () => (await api.get('/api/health')).status()).toBe(200);
    const afterHistory = await (await api.get('/api/levels/1/history?limit=500')).json();
    const afterLevels = await (await api.get('/api/levels')).json();
    expect(afterHistory).toEqual(beforeHistory);
    expect(afterLevels).toEqual(beforeLevels);
  });

  test('Abgelehnte Meldungen landen nicht in der Historie', async () => {
    const failed = await api.post('/api/levels/1/result', {
      data: { checks: [{ name: 'Fehlschlag', ok: false }], durationMs: 1 },
    });
    expect(failed.status()).toBe(200);
    const before = await (await api.get('/api/levels/2/history?limit=500')).json();
    const rejected = await api.post('/api/levels/2/result', {
      data: { checks: [{ name: 'Probe', ok: true }], durationMs: 1 },
    });
    expect(rejected.status()).toBe(409);
    const after = await (await api.get('/api/levels/2/history?limit=500')).json();
    expect(after).toEqual(before);
  });

  test('Datenbank hat das vorgegebene Schema', () => {
    const db = new DatabaseSync(path.join(projectRoot, '.run', 'levelboard.db'), { readOnly: true });
    try {
      expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
      const columns = (table: string) =>
        (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((row) => row.name);
      expect(columns('levels')).toEqual(['level', 'status', 'checked_at', 'duration_ms', 'checks', 'metrics']);
      expect(columns('reports')).toEqual(['id', 'level', 'status', 'checked_at', 'duration_ms', 'checks', 'metrics']);
      expect(columns('meta')).toEqual(['key', 'value']);
      expect(db.prepare('SELECT COUNT(*) AS count FROM levels').get()).toEqual({ count: 10 });
    } finally {
      db.close();
    }
  });
});

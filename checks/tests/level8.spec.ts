import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const liveUrl = process.env.LIVE_URL || '';
const runId = process.env.RUN_ID || 'lokal';
const repo = process.env.GITHUB_REPO || '';
const projectRoot = path.resolve(process.cwd(), '..');

function ghApi(endpoint: string) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

function head() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
}

test.describe('level-8', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Job deploy des letzten Laufs ist grün', () => {
    const sha = head();
    const runs = ghApi(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`);
    expect(runs.workflow_runs.length).toBeGreaterThan(0);
    const run = runs.workflow_runs[0];
    const jobs = ghApi(`repos/${repo}/actions/runs/${run.id}/jobs`);
    const deploy = jobs.jobs.find((job: { name: string }) => job.name === 'deploy');
    expect(deploy, 'Job deploy fehlt').toBeTruthy();
    expect(deploy.conclusion).toBe('success');
  });

  test('Live-Seite antwortet über HTTPS', async ({ page, request }) => {
    expect(liveUrl.startsWith('https://')).toBe(true);
    const response = await request.get(`${liveUrl}/`);
    expect(response.status()).toBe(200);
    await page.goto(`${liveUrl}/`);
    await expect(page.getByTestId('board')).toHaveAttribute('data-state', 'ok');
    await expect(page.getByTestId('run-source')).toHaveAttribute('data-source', 'api');
  });

  test('Live-Seite meldet den aktuellen Commit', async ({ page, request }) => {
    const sha = head();
    const health = await request.get(`${liveUrl}/api/health`);
    expect(health.status()).toBe(200);
    expect((await health.json()).commit).toBe(sha);
    await page.goto(`${liveUrl}/`);
    await expect(page.getByTestId('run-commit')).toHaveText(sha.slice(0, 7));
  });

  test('Live-Seite zeigt die Ergebnisse der Pipeline', async ({ request }) => {
    const response = await request.get(`${liveUrl}/api/levels`);
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.run.id).toBe(runId);
    for (let i = 0; i < 5; i += 1) {
      expect(body.levels[i].status).toBe('bestanden');
    }
  });
});

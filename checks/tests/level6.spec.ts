import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const repo = process.env.GITHUB_REPO || '';
const projectRoot = path.resolve(process.cwd(), '..');

function ghApi(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

function head() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
}

test.describe('level-6', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Repo existiert und ist öffentlich', () => {
    const info = ghApi(`repos/${repo}`);
    expect(info.full_name).toBe(repo);
    expect(info.visibility).toBe('public');
    expect(info.default_branch).toBe('main');
  });

  test('Lokaler Stand ist gepusht', () => {
    const status = execFileSync('git', ['status', '--porcelain'], { cwd: projectRoot, encoding: 'utf8' }).trim();
    expect(status).toBe('');
    const branch = ghApi(`repos/${repo}/branches/main`);
    expect(head()).toBe(branch.commit.sha);
  });

  test('Letzter Pipeline-Lauf ist grün', () => {
    const sha = head();
    const runs = ghApi(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`);
    expect(runs.workflow_runs.length).toBeGreaterThan(0);
    expect(runs.workflow_runs[0].status).toBe('completed');
    expect(runs.workflow_runs[0].conclusion).toBe('success');
  });

  test('Report enthält Level 1–5 bestanden', () => {
    const sha = head();
    const runs = ghApi(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`);
    const id = runs.workflow_runs[0].id;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levelboard-report-'));
    execFileSync('gh', ['run', 'download', String(id), '--repo', repo, '--name', 'levelboard-report', '--dir', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const direct = path.join(dir, 'results.json');
    const nested = path.join(dir, 'frontend', 'dist', 'results.json');
    const file = fs.existsSync(direct) ? direct : nested;
    expect(fs.existsSync(file), 'results.json fehlt im Artefakt').toBe(true);
    expect(fs.existsSync(path.join(dir, 'playwright.json')) || fs.existsSync(path.join(dir, 'checks', '.out', 'playwright.json'))).toBe(true);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (let n = 1; n <= 5; n += 1) {
      const level = data.levels[n - 1];
      expect(level.status, `Level ${n}`).toBe('bestanden');
      expect(level.checks.length).toBeGreaterThan(0);
    }
  });
});

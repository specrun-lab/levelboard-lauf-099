import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const repo = process.env.GITHUB_REPO || '';
const projectRoot = path.resolve(process.cwd(), '..');
const ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

function ghApi(endpoint) {
  return JSON.parse(execFileSync('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

function head() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
}

function latestRun(sha) {
  return ghApi(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`).workflow_runs[0];
}

test.describe('level-7', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Job images des letzten Laufs ist grün', () => {
    const run = latestRun(head());
    const jobs = ghApi(`repos/${repo}/actions/runs/${run.id}/jobs`);
    const images = jobs.jobs.find((job) => job.name === 'images');
    expect(images, 'Job images fehlt').toBeTruthy();
    expect(images.conclusion).toBe('success');
  });

  test('Beide Images liegen öffentlich in der GHCR', async () => {
    const sha = head();
    for (const part of ['frontend', 'backend']) {
      const name = `${repo}-${part}`;
      const tokenResponse = await fetch(`https://ghcr.io/token?scope=${encodeURIComponent(`repository:${name}:pull`)}`);
      expect(tokenResponse.status, name).toBe(200);
      const token = (await tokenResponse.json()).token;
      expect(token, name).toBeTruthy();
      const manifest = await fetch(`https://ghcr.io/v2/${name}/manifests/${sha}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: ACCEPT },
        method: 'HEAD',
      });
      expect(manifest.status(), name).toBeGreaterThanOrEqual(200);
      expect(manifest.status(), name).toBeLessThan(300);
    }
  });

  test('Report der Container-Suite enthält nur bestandene Checks', () => {
    const run = latestRun(head());
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'levelboard-container-'));
    execFileSync('gh', ['run', 'download', String(run.id), '--repo', repo, '--name', 'levelboard-container-report', '--dir', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const direct = path.join(dir, 'playwright.json');
    const nested = path.join(dir, 'checks', '.out', 'playwright.json');
    const file = fs.existsSync(direct) ? direct : nested;
    expect(fs.existsSync(file), 'playwright.json fehlt im Artefakt').toBe(true);
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    const specs = [];
    for (const suite of report.suites || []) {
      for (const child of suite.suites || []) specs.push(...(child.specs || []));
      specs.push(...(suite.specs || []));
    }
    expect(specs.length).toBeGreaterThanOrEqual(6);
    for (const spec of specs) {
      expect(spec.ok, spec.title).toBe(true);
    }
  });
});

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { imageSizeMB, pipelineOf } from '../collect-report.mjs';
import { levelTokens } from '../collect-tokens.mjs';
function pad(value) {
  return String(value).padStart(2, '0');
}
function formatSeconds(value) {
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value - minutes * 60);
  return `${minutes}:${pad(seconds)} min`;
}
function formatCostValue(value) {
  return `${value.toFixed(2).replace('.', ',')} USD`;
}
function formatNumber(value) {
  return value.toLocaleString('de-CH');
}
function formatDecimal1(value) {
  return value.toFixed(1).replace('.', ',');
}

const liveUrl = (process.env.LIVE_URL || '').replace(/\/$/, '');
const repo = process.env.GITHUB_REPO || '';
const projectRoot = path.resolve(process.cwd(), '..');

function head() {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: projectRoot, encoding: 'utf8' }).trim();
}

test.describe('level-10', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(120_000);

  test('Alle Teile des Berichts sind vorhanden', async () => {
    const sha = head();
    const pipeline = await pipelineOf(repo, sha);
    expect(pipeline.jobs.check).toBeGreaterThan(0);
    expect(pipeline.jobs.images).toBeGreaterThan(0);
    expect(pipeline.jobs.deploy).toBeGreaterThan(0);

    const images = {
      frontendMB: await imageSizeMB(`${repo}-frontend`, sha),
      backendMB: await imageSizeMB(`${repo}-backend`, sha),
    };
    expect(images.frontendMB).toBeGreaterThan(0);
    expect(images.backendMB).toBeGreaterThan(0);

    const loadtestPath = path.resolve(process.cwd(), '.out', 'loadtest.json');
    const loadtest = JSON.parse(fs.readFileSync(loadtestPath, 'utf8'));
    expect(loadtest.requests).toBeGreaterThan(0);

    const current = Array.from({ length: 10 }, (_, i) => ({ level: i + 1, status: 'bestanden' as const }));
    const tokensMap = levelTokens(current);
    for (let i = 1; i <= 10; i += 1) expect(tokensMap[i], `Tokens für Level ${i}`).toBeTruthy();

    const report = { pipeline, images, loadtest, tokens: tokensMap };
    const out = path.resolve(process.cwd(), '.out', 'bericht.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
  });

  test('Vollständiger Bericht wird dargestellt', async ({ page }) => {
    const report = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '.out', 'bericht.json'), 'utf8'));
    await page.route('**/api/levels', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.levels = body.levels.map((level: any, index: number) => {
        const metrics: any = { tokens: report.tokens[index + 1] };
        if (index === 5) metrics.pipeline = report.pipeline;
        if (index === 6) metrics.images = report.images;
        if (index === 8) metrics.loadtest = report.loadtest;
        return { ...level, status: 'bestanden', checkedAt: new Date().toISOString(), metrics };
      });
      await route.fulfill({ response, json: body });
    });

    await page.goto(`${liveUrl}/`);
    await expect(page.getByTestId('report')).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('report-reached')).toHaveText('10 / 10');
    await expect(page.getByTestId('report-complete')).toHaveText('ja');

    const own = Object.values(report.tokens).filter((token: any) => !('inLevel' in token));
    const cost = own.reduce((sum: number, token: any) => sum + token.costUsd, 0);
    const build = own.reduce((sum: number, token: any) => sum + token.buildS, 0);
    const output = own.reduce((sum: number, token: any) => sum + token.output, 0);

    await expect(page.getByTestId('report-cost')).toHaveText(formatCostValue(cost));
    await expect(page.getByTestId('report-tokens-output')).toHaveText(formatNumber(output));
    await expect(page.getByTestId('report-build-time')).toHaveText(formatSeconds(build));
    await expect(page.getByTestId('report-p95')).toHaveText(`${report.loadtest.p95Ms} ms`);
    await expect(page.getByTestId('report-image-frontend')).toHaveText(`${formatDecimal1(report.images.frontendMB)} MB`);
    await expect(page.getByTestId('report-job-check')).toHaveText(`${report.pipeline.jobs.check} s`);
    await expect(page.getByTestId('report-job-images')).toHaveText(`${report.pipeline.jobs.images} s`);
    await expect(page.getByTestId('report-job-deploy')).toHaveText(`${report.pipeline.jobs.deploy} s`);
    await expect(page.getByTestId('report-pipeline-link')).toHaveAttribute('href', report.pipeline.url);

    for (let i = 1; i <= 10; i += 1) {
      const token: any = report.tokens[i];
      const card = page.locator(`[data-testid="level-card"][data-level="${i}"]`);
      if ('inLevel' in token) {
        const value = `in L${String(token.inLevel).padStart(2, '0')}`;
        await expect(card.getByTestId('level-build-time')).toHaveText(value);
        await expect(card.getByTestId('level-cost')).toHaveText(value);
        await expect(card.getByTestId('level-output')).toHaveText(value);
      } else {
        await expect(card.getByTestId('level-build-time')).toHaveText(formatSeconds(token.buildS));
        await expect(card.getByTestId('level-cost')).toHaveText(formatCostValue(token.costUsd));
        await expect(card.getByTestId('level-output')).toHaveText(formatNumber(token.output));
      }
    }
  });

  test('Teilbericht zeigt fehlende Teile', async ({ page }) => {
    const report = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), '.out', 'bericht.json'), 'utf8'));
    await page.route('**/api/levels', async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.levels = body.levels.map((level: any, index: number) => {
        if (index < 2) {
          return {
            ...level,
            status: 'bestanden',
            checkedAt: new Date().toISOString(),
            metrics: { tokens: report.tokens[index + 1] },
          };
        }
        return {
          ...level,
          status: 'offen',
          checkedAt: null,
          durationMs: null,
          checks: [],
          metrics: {},
        };
      });
      await route.fulfill({ response, json: body });
    });

    await page.goto(`${liveUrl}/`);
    await expect(page.getByTestId('report')).toHaveAttribute('data-state', 'ready');
    await expect(page.getByTestId('report-reached')).toHaveText('2 / 10');
    await expect(page.getByTestId('report-complete')).toHaveText('nein');
    await expect(page.getByTestId('report-pipeline-missing')).toHaveText('noch nicht erreicht');
    await expect(page.getByTestId('report-images-missing')).toHaveText('noch nicht erreicht');
    await expect(page.getByTestId('report-loadtest-missing')).toHaveText('noch nicht erreicht');
    await expect(page.getByTestId('report-tokens-missing')).toHaveCount(0);
  });
});

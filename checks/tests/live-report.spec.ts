import { expect, test } from '@playwright/test';
function formatSeconds(value) {
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value - minutes * 60);
  return `${minutes}:${String(seconds).padStart(2, '0')} min`;
}
function formatCostValue(value) {
  return `${value.toFixed(2).replace('.', ',')} USD`;
}
function formatDecimal1(value) {
  return value.toFixed(1).replace('.', ',');
}

const liveUrl = (process.env.LIVE_URL || '').replace(/\/$/, '');

test.describe('live-bericht', () => {
  test('Live-Seite zeigt den gemeldeten Abschlussbericht', async ({ page, request }) => {
    const response = await request.get(`${liveUrl}/api/levels`);
    expect(response.status()).toBe(200);
    const body = await response.json();

    expect(body.levels).toHaveLength(10);
    for (const level of body.levels) {
      expect(level.status).toBe('bestanden');
      expect(level.metrics.tokens).toBeTruthy();
    }
    expect(body.levels[5].metrics.pipeline).toBeTruthy();
    expect(body.levels[6].metrics.images).toBeTruthy();
    expect(body.levels[8].metrics.loadtest).toBeTruthy();

    await page.goto(`${liveUrl}/`);
    await expect(page.getByTestId('report')).toHaveAttribute('data-complete', 'true');
    await expect(page.getByTestId('summary-reached')).toHaveText('10 / 10');
    await expect(page.getByTestId('report-score')).toHaveText('100 / 100');
    await expect(page.getByTestId('report-commit')).toHaveText(body.run.commit.slice(0, 7));

    const tokenLevels = body.levels
      .map((level: any) => level.metrics.tokens)
      .filter((token: any) => token && !('inLevel' in token));
    const cost = tokenLevels.reduce((sum: number, token: any) => sum + token.costUsd, 0);
    const build = tokenLevels.reduce((sum: number, token: any) => sum + token.buildS, 0);
    await expect(page.getByTestId('report-cost')).toHaveText(formatCostValue(cost));
    await expect(page.getByTestId('report-build-time')).toHaveText(formatSeconds(build));

    await expect(page.getByTestId('report-p95')).toHaveText(`${body.levels[8].metrics.loadtest.p95Ms} ms`);
    await expect(page.getByTestId('report-image-backend')).toHaveText(
      `${formatDecimal1(body.levels[6].metrics.images.backendMB)} MB`,
    );
    await expect(page.getByTestId('report-pipeline-total')).toHaveText(`${body.levels[5].metrics.pipeline.totalS} s`);
    await expect(page.getByTestId('report-level')).toHaveCount(10);
    for (let i = 0; i < 10; i += 1) {
      await expect(page.getByTestId('report-level').nth(i)).toHaveAttribute('data-status', 'bestanden');
    }
  });
});

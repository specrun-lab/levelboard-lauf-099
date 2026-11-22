import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(process.cwd(), '..');
const reportPath = path.join(process.cwd(), '.out', 'playwright.json');
const resultsPath = path.join(root, 'frontend', 'dist', 'results.json');

const levelsArg = process.argv
  .slice(2)
  .map((value) => Number(value))
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 10);

if (levelsArg.length === 0) {
  console.error('Keine Level angegeben');
  process.exit(1);
}

function abort(message) {
  console.error(message);
  process.exit(1);
}

function collectChecks(report) {
  const found = new Map();
  const walk = (suite) => {
    const match = /^level-(\d+)$/.exec(suite.title || '');
    if (match) {
      const number = Number(match[1]);
      if (!found.has(number)) found.set(number, []);
      for (const spec of suite.specs || []) {
        const tests = spec.tests || [];
        const ok = spec.ok === true && tests.every((test) => test.status === 'expected' || test.status === 'flaky');
        const duration = tests.reduce(
          (sum, test) => sum + (test.results || []).reduce((inner, result) => inner + (result.duration || 0), 0),
          0,
        );
        found.get(number).push({ name: spec.title, ok, duration });
      }
    }
    for (const child of suite.suites || []) walk(child);
  };
  for (const suite of report.suites || []) walk(suite);
  return found;
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
} catch (error) {
  abort(`Playwright-Report nicht lesbar: ${error.message}`);
}

const checksByLevel = collectChecks(report);
for (const number of levelsArg) {
  if (!checksByLevel.has(number) || checksByLevel.get(number).length === 0) {
    abort(`Keine Checks für Level ${number} gefunden`);
  }
}

let data;
try {
  data = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
} catch (error) {
  abort(`results.json nicht lesbar: ${error.message}`);
}

const now = new Date().toISOString();
if (process.env.RUN_ID) data.run.id = process.env.RUN_ID;
data.run.updatedAt = now;

const smallest = Math.min(...levelsArg);
const statusByLevel = new Map();
let failed = false;
for (const level of [...levelsArg].sort((a, b) => a - b)) {
  const checks = checksByLevel.get(level);
  if (failed) continue;
  const status = checks.every((check) => check.ok) ? 'bestanden' : 'fehlgeschlagen';
  const durationMs = Math.round(checks.reduce((sum, check) => sum + check.duration, 0));
  data.levels[level - 1].status = status;
  data.levels[level - 1].checkedAt = now;
  data.levels[level - 1].durationMs = durationMs;
  data.levels[level - 1].checks = checks.map((check) => ({ name: check.name, ok: check.ok }));
  data.levels[level - 1].metrics = {};
  statusByLevel.set(level, status);
  if (status === 'fehlgeschlagen') failed = true;
}

const resetStatus = failed ? 'gesperrt' : 'offen';
for (let level = smallest + 1; level <= 10; level += 1) {
  if (statusByLevel.has(level)) continue;
  data.levels[level - 1].status = resetStatus;
  data.levels[level - 1].checkedAt = null;
  data.levels[level - 1].durationMs = null;
  data.levels[level - 1].checks = [];
  data.levels[level - 1].metrics = {};
}

const checkedLevels = data.levels
  .filter((level) => level.status === 'bestanden' || level.status === 'fehlgeschlagen')
  .map((level) => ({ level: level.level, status: level.status }));

let tokenMap = {};
try {
  const { levelTokens } = await import('./collect-tokens.mjs');
  tokenMap = levelTokens(checkedLevels);
} catch (error) {
  console.log(`Token-Kennzahlen nicht verfügbar: ${error.message}`);
}

for (const level of checkedLevels) {
  const tokens = tokenMap[level.level];
  if (tokens !== undefined) data.levels[level.level - 1].metrics.tokens = tokens;
}

if (statusByLevel.get(6) === 'bestanden' && process.env.GITHUB_REPO) {
  try {
    const { pipelineOf } = await import('./collect-report.mjs');
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    data.levels[5].metrics.pipeline = await pipelineOf(process.env.GITHUB_REPO, sha);
  } catch (error) {
    console.log(`Pipeline-Kennzahl nicht verfügbar: ${error.message}`);
  }
}

if (statusByLevel.get(7) === 'bestanden' && process.env.GITHUB_REPO) {
  try {
    const { imageSizeMB } = await import('./collect-report.mjs');
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    data.levels[6].metrics.images = {
      frontendMB: await imageSizeMB(`${process.env.GITHUB_REPO}-frontend`, sha),
      backendMB: await imageSizeMB(`${process.env.GITHUB_REPO}-backend`, sha),
    };
  } catch (error) {
    console.log(`Image-Kennzahl nicht verfügbar: ${error.message}`);
  }
}

const loadtestPath = path.join(process.cwd(), '.out', 'loadtest.json');
if (statusByLevel.get(9) === 'bestanden' && fs.existsSync(loadtestPath)) {
  try {
    data.levels[8].metrics.loadtest = JSON.parse(fs.readFileSync(loadtestPath, 'utf8'));
  } catch (error) {
    console.log(`Lasttest-Kennzahl nicht verfügbar: ${error.message}`);
  }
}

fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
fs.writeFileSync(resultsPath, JSON.stringify(data, null, 2) + '\n');

for (const number of [...levelsArg].sort((a, b) => a - b)) {
  const level = data.levels[number - 1];
  const checks = checksByLevel.get(number);
  const detail = checks.length > 0 ? ` (${checks.filter((check) => check.ok).length}/${checks.length} Checks)` : '';
  console.log(`Level ${number}: ${level.status}${detail}`);
}

let exitCode = failed ? 1 : 0;

async function reportTo(base, backend) {
  if (!base) return;
  const label = backend ? 'das Backend' : 'die Live-API';
  for (const number of [...levelsArg].sort((a, b) => a - b)) {
    const level = data.levels[number - 1];
    if (level.status !== 'bestanden' && level.status !== 'fehlgeschlagen') break;
    if (level.checks.length === 0) break;
    let response;
    try {
      response = await fetch(`${base}/api/levels/${number}/result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ checks: level.checks, durationMs: level.durationMs, metrics: level.metrics }),
      });
    } catch (error) {
      console.log(`Meldung an ${label} für Level ${number} fehlgeschlagen: ${error.message}`);
      return false;
    }
    if (!response.ok) {
      const text = (await response.text()).trim();
      console.log(`Meldung an ${label} für Level ${number} fehlgeschlagen: ${response.status} ${text}`);
      return false;
    }
    console.log(`Level ${number} an ${label} gemeldet`);
    if (level.status === 'fehlgeschlagen') break;
  }
  return true;
}

if (process.env.REPORT_API === '1') {
  const accepted = await reportTo(process.env.API_URL || 'http://127.0.0.1:8081', true);
  if (!accepted) exitCode = 1;
}

if (process.env.REPORT_LIVE === '1') {
  const accepted = await reportTo(process.env.LIVE_URL, false);
  if (!accepted) exitCode = 1;
}

process.exit(exitCode);

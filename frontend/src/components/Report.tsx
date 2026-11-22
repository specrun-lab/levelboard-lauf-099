import type { ReactNode } from 'react';
import type { Level, Metrics } from '../results';
import {
  formatCostValue,
  formatDate,
  formatDecimal1,
  formatNumber,
  formatSeconds,
  isTokenObject,
  reachedLevel,
  TITLES,
} from '../results';

interface Props {
  levels: Level[];
  run: { commit: string | null; updatedAt: string | null };
}

const LABELS: Record<Level['status'], string> = {
  offen: 'Offen',
  bestanden: 'Bestanden',
  fehlgeschlagen: 'Fehlgeschlagen',
  gesperrt: 'Gesperrt',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function number(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

interface TileProps {
  title: string;
  children: ReactNode;
}

function Tile({ title, children }: TileProps) {
  return (
    <div className="tile">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

interface RowProps {
  label: string;
  value: string;
  testid: string;
}

function Row({ label, value, testid }: RowProps) {
  return (
    <div className="report-row">
      <dt>{label}</dt>
      <dd className="mono" data-testid={testid}>{value}</dd>
    </div>
  );
}

function Missing({ testid }: { testid: string }) {
  return <p className="missing-value" data-testid={testid}>noch nicht erreicht</p>;
}

function metricsAt(levels: Level[], index: number): Metrics | null {
  const level = levels[index];
  return level ? level.metrics : null;
}

export default function Report({ levels, run }: Props) {
  const ready = levels.some((level) => level.checkedAt !== null);
  const complete = levels[9]?.status === 'bestanden';
  const reached = reachedLevel(levels);

  const tokenLevels = levels.filter((level) => isTokenObject(level.metrics));
  const tokens = tokenLevels.map((level) => level.metrics.tokens as Record<string, unknown>);
  const models = new Set<string>();
  for (const token of tokens) {
    if (Array.isArray(token.models)) {
      for (const model of token.models) {
        if (typeof model === 'string') models.add(model);
      }
    }
  }
  const allHaveBuild = tokens.every((token) => typeof token.buildS === 'number');
  const buildTotal = tokens.reduce((sum, token) => sum + number(token.buildS), 0);
  const costTotal = tokens.reduce((sum, token) => sum + number(token.costUsd), 0);

  const pipelineRaw = metricsAt(levels, 5)?.pipeline;
  const pipeline = isRecord(pipelineRaw) ? pipelineRaw : null;
  const jobs = pipeline && isRecord(pipeline.jobs) ? pipeline.jobs : null;
  const imagesRaw = metricsAt(levels, 6)?.images;
  const images = isRecord(imagesRaw) ? imagesRaw : null;
  const loadtestRaw = metricsAt(levels, 8)?.loadtest;
  const loadtest = isRecord(loadtestRaw) ? loadtestRaw : null;

  return (
    <section
      className="report"
      aria-label="Abschlussbericht"
      data-testid="report"
      data-state={ready ? 'ready' : 'empty'}
      data-complete={complete ? 'true' : 'false'}
    >
      <h2>Abschlussbericht</h2>
      {!ready ? (
        <p className="report-empty" data-testid="report-empty">
          Noch kein Abschlussbericht – er erscheint, sobald das erste Level geprüft ist.
        </p>
      ) : (
        <>
          <div className="tiles">
            <Tile title="Ergebnis">
              <dl>
                <Row label="Erreicht" value={`${reached} / 10`} testid="report-reached" />
                <Row label="Score" value={`${reached * 10} / 100`} testid="report-score" />
                <Row label="Vollständig" value={complete ? 'ja' : 'nein'} testid="report-complete" />
                <Row
                  label="Bauzeit gesamt"
                  value={allHaveBuild && tokens.length > 0 ? formatSeconds(buildTotal) : '–'}
                  testid="report-build-time"
                />
                <Row label="Commit" value={run.commit ? run.commit.slice(0, 7) : '–'} testid="report-commit" />
                <Row label="Stand" value={formatDate(run.updatedAt)} testid="report-time" />
              </dl>
            </Tile>

            {tokenLevels.length === 0 ? (
              <Tile title="Tokens"><Missing testid="report-tokens-missing" /></Tile>
            ) : (
              <Tile title="Tokens">
                <dl>
                  <Row label="Modell" value={[...models].sort().join(', ')} testid="report-model" />
                  <Row
                    label="Antworten"
                    value={formatNumber(tokens.reduce((sum, token) => sum + number(token.responses), 0))}
                    testid="report-responses"
                  />
                  <Row
                    label="Eingabe"
                    value={formatNumber(tokens.reduce((sum, token) => sum + number(token.input), 0))}
                    testid="report-tokens-input"
                  />
                  <Row
                    label="Cache schreiben"
                    value={formatNumber(
                      tokens.reduce((sum, token) => sum + number(token.cacheWrite5m) + number(token.cacheWrite1h), 0),
                    )}
                    testid="report-tokens-cache-write"
                  />
                  <Row
                    label="Cache lesen"
                    value={formatNumber(tokens.reduce((sum, token) => sum + number(token.cacheRead), 0))}
                    testid="report-tokens-cache-read"
                  />
                  <Row
                    label="Ausgabe"
                    value={formatNumber(tokens.reduce((sum, token) => sum + number(token.output), 0))}
                    testid="report-tokens-output"
                  />
                  <Row
                    label="Gesamt"
                    value={formatNumber(tokens.reduce((sum, token) => sum + number(token.total), 0))}
                    testid="report-tokens-total"
                  />
                  <Row label="Kosten (API-Preis)" value={formatCostValue(costTotal)} testid="report-cost" />
                </dl>
              </Tile>
            )}

            {!loadtest ? (
              <Tile title="Lasttest"><Missing testid="report-loadtest-missing" /></Tile>
            ) : (
              <Tile title="Lasttest">
                <dl>
                  <Row label="p50" value={`${number(loadtest.p50Ms)} ms`} testid="report-p50" />
                  <Row label="p95" value={`${number(loadtest.p95Ms)} ms`} testid="report-p95" />
                  <Row
                    label="Durchsatz"
                    value={`${formatDecimal1(number(loadtest.rps))} Anfragen/s`}
                    testid="report-rps"
                  />
                  <Row label="Fehler" value={String(number(loadtest.errors))} testid="report-errors" />
                </dl>
              </Tile>
            )}

            {!images ? (
              <Tile title="Images"><Missing testid="report-images-missing" /></Tile>
            ) : (
              <Tile title="Images">
                <dl>
                  <Row
                    label="Frontend"
                    value={`${formatDecimal1(number(images.frontendMB))} MB`}
                    testid="report-image-frontend"
                  />
                  <Row
                    label="Backend"
                    value={`${formatDecimal1(number(images.backendMB))} MB`}
                    testid="report-image-backend"
                  />
                </dl>
              </Tile>
            )}

            {!pipeline ? (
              <Tile title="Pipeline"><Missing testid="report-pipeline-missing" /></Tile>
            ) : (
              <Tile title="Pipeline">
                <dl>
                  <Row
                    label="check"
                    value={jobs && typeof jobs.check === 'number' ? `${jobs.check} s` : '–'}
                    testid="report-job-check"
                  />
                  <Row
                    label="images"
                    value={jobs && typeof jobs.images === 'number' ? `${jobs.images} s` : '–'}
                    testid="report-job-images"
                  />
                  <Row
                    label="deploy"
                    value={jobs && typeof jobs.deploy === 'number' ? `${jobs.deploy} s` : '–'}
                    testid="report-job-deploy"
                  />
                  <Row label="Gesamt" value={`${number(pipeline.totalS)} s`} testid="report-pipeline-total" />
                </dl>
                <a
                  className="pipeline-link"
                  data-testid="report-pipeline-link"
                  href={typeof pipeline.url === 'string' ? pipeline.url : '#'}
                  target="_blank"
                  rel="noreferrer"
                >
                  Lauf ansehen
                </a>
              </Tile>
            )}
          </div>

          <ol className="report-levels" data-testid="report-levels">
            {levels.map((level, index) => (
              <li
                key={level.level}
                data-testid="report-level"
                data-level={level.level}
                data-status={level.status}
              >
                <span>L{String(level.level).padStart(2, '0')} {TITLES[index]}</span>
                <span className={`status-text status-${level.status}`}>{LABELS[level.status]}</span>
                <span className="mono">{formatDate(level.checkedAt)}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

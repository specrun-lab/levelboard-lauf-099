export type Status = 'offen' | 'bestanden' | 'fehlgeschlagen' | 'gesperrt';

export interface Check {
  name: string;
  ok: boolean;
}

export type Metrics = Record<string, unknown>;

export interface Level {
  level: number;
  title: string;
  status: Status;
  checkedAt: string | null;
  durationMs: number | null;
  checks: Check[];
  metrics: Metrics;
}

export interface Run {
  id: string;
  version: string;
  commit: string | null;
  updatedAt: string | null;
}

export interface Results {
  run: Run;
  levels: Level[];
}

export type LoadState = 'loading' | 'ok' | 'missing' | 'invalid' | 'unavailable';
export type Source = 'file' | 'api' | null;

export const TITLES = [
  'Statische Seite',
  'Webserver',
  'REST-Backend',
  'Datenbank',
  'Frontend + Backend',
  'Repo + CI',
  'Images in der Pipeline',
  'Deployment',
  'Live-Prüfung',
  'Metriken veröffentlicht',
] as const;

const STATUSES: Status[] = ['offen', 'bestanden', 'fehlgeschlagen', 'gesperrt'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isDateString(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function emptyResults(): Results {
  return {
    run: { id: '–', version: '–', commit: null, updatedAt: null },
    levels: TITLES.map((title, index) => ({
      level: index + 1,
      title,
      status: 'offen' as Status,
      checkedAt: null,
      durationMs: null,
      checks: [],
      metrics: {},
    })),
  };
}

export function parseResults(value: unknown): Results | null {
  if (!isRecord(value) || !exactKeys(value, ['run', 'levels'])) return null;

  const run = value.run;
  if (!isRecord(run) || !exactKeys(run, ['id', 'version', 'commit', 'updatedAt'])) return null;
  if (typeof run.id !== 'string' || run.id.length === 0) return null;
  if (typeof run.version !== 'string' || run.version.length === 0) return null;
  if (run.commit !== null && typeof run.commit !== 'string') return null;
  if (run.updatedAt !== null && !isDateString(run.updatedAt)) return null;

  const levels = value.levels;
  if (!Array.isArray(levels) || levels.length !== 10) return null;

  const seen = new Set<number>();
  for (const raw of levels) {
    if (!isRecord(raw)) return null;
    if (!exactKeys(raw, ['level', 'title', 'status', 'checkedAt', 'durationMs', 'checks', 'metrics'])) return null;
    if (!Number.isInteger(raw.level) || (raw.level as number) < 1 || (raw.level as number) > 10) return null;
    const number = raw.level as number;
    if (seen.has(number)) return null;
    seen.add(number);
    if (typeof raw.title !== 'string') return null;
    if (typeof raw.status !== 'string' || !STATUSES.includes(raw.status as Status)) return null;
    if (raw.checkedAt !== null && !isDateString(raw.checkedAt)) return null;
    if (raw.durationMs !== null && (!Number.isInteger(raw.durationMs) || (raw.durationMs as number) < 0)) return null;
    if (!Array.isArray(raw.checks)) return null;
    for (const check of raw.checks) {
      if (!isRecord(check) || !exactKeys(check, ['name', 'ok'])) return null;
      if (typeof check.name !== 'string' || check.name.length === 0) return null;
      if (typeof check.ok !== 'boolean') return null;
    }
    if (!isRecord(raw.metrics)) return null;
  }
  if (seen.size !== 10) return null;

  return value as unknown as Results;
}

export function reachedLevel(levels: Level[]): number {
  let reached = 0;
  for (const level of levels) {
    if (level.status !== 'bestanden') break;
    reached += 1;
  }
  return reached;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDate(value: string | null): string {
  if (value === null || Number.isNaN(Date.parse(value))) return '–';
  const date = new Date(value);
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDuration(value: number | null): string {
  if (value === null) return '–';
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1).replace('.', ',')} s`;
}

export function formatChecks(checks: Check[]): string {
  if (checks.length === 0) return '–';
  return `${checks.filter((check) => check.ok).length}/${checks.length}`;
}

export function formatSeconds(value: number): string {
  if (value < 60) return `${Math.round(value)} s`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value - minutes * 60);
  return `${minutes}:${pad(seconds)} min`;
}

export function formatInLevel(value: unknown): string | null {
  if (!isRecord(value) || typeof value.inLevel !== 'number' || !Number.isInteger(value.inLevel)) return null;
  return `in L${pad(value.inLevel)}`;
}

export function formatBuild(metrics: Metrics): string {
  const tokens = metrics.tokens;
  const inLevel = formatInLevel(tokens);
  if (inLevel !== null) return inLevel;
  if (!isRecord(tokens) || typeof tokens.buildS !== 'number') return '–';
  return formatSeconds(tokens.buildS);
}

export function formatCostValue(value: number): string {
  return `${value.toFixed(2).replace('.', ',')} USD`;
}

export function formatCost(metrics: Metrics): string {
  const tokens = metrics.tokens;
  const inLevel = formatInLevel(tokens);
  if (inLevel !== null) return inLevel;
  if (!isRecord(tokens) || typeof tokens.costUsd !== 'number') return '–';
  return formatCostValue(tokens.costUsd);
}

export function formatNumber(value: number): string {
  return value.toLocaleString('de-CH');
}

export function formatOutput(metrics: Metrics): string {
  const tokens = metrics.tokens;
  if (formatInLevel(tokens) !== null) return `in L${pad((tokens as Record<string, unknown>).inLevel as number)}`;
  if (!isRecord(tokens) || typeof tokens.output !== 'number') return '–';
  return formatNumber(tokens.output);
}

export function formatDecimal1(value: number): string {
  return value.toFixed(1).replace('.', ',');
}

export function isTokenObject(metrics: Metrics): boolean {
  const tokens = metrics.tokens;
  return isRecord(tokens) && !Object.prototype.hasOwnProperty.call(tokens, 'inLevel');
}

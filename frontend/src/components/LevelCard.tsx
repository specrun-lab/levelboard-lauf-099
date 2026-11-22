import type { Level } from '../results';
import { formatBuild, formatChecks, formatCost, formatDate, formatDuration, formatOutput, TITLES } from '../results';

interface Props {
  level: Level;
  index: number;
}

const LABELS: Record<Level['status'], string> = {
  offen: 'Offen',
  bestanden: 'Bestanden',
  fehlgeschlagen: 'Fehlgeschlagen',
  gesperrt: 'Gesperrt',
};

interface FactProps {
  label: string;
  value: string;
  testid: string;
}

function Fact({ label, value, testid }: FactProps) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd className="mono" data-testid={testid}>{value}</dd>
    </div>
  );
}

export default function LevelCard({ level, index }: Props) {
  return (
    <article
      className={`card status-${level.status}`}
      data-testid="level-card"
      data-level={level.level}
      data-status={level.status}
    >
      <div className="card-head">
        <span className="card-number">L{String(level.level).padStart(2, '0')}</span>
        <span className="badge" data-testid="level-status">
          <span className="badge-dot" aria-hidden="true" />
          {LABELS[level.status]}
        </span>
      </div>
      <h2 className="card-title" data-testid="level-title">{TITLES[index]}</h2>
      <dl className="facts">
        <Fact label="Geprüft" value={formatDate(level.checkedAt)} testid="level-checked-at" />
        <Fact label="Checkdauer" value={formatDuration(level.durationMs)} testid="level-duration" />
        <Fact label="Checks" value={formatChecks(level.checks)} testid="level-checks" />
        <Fact label="Bauzeit" value={formatBuild(level.metrics)} testid="level-build-time" />
        <Fact label="Kosten" value={formatCost(level.metrics)} testid="level-cost" />
        <Fact label="Tokens (Ausgabe)" value={formatOutput(level.metrics)} testid="level-output" />
      </dl>
    </article>
  );
}

import type { Level } from '../results';
import { formatDate, reachedLevel } from '../results';

interface Props {
  levels: Level[];
  updatedAt: string | null;
}

const LABELS: Record<Level['status'], string> = {
  offen: 'Offen',
  bestanden: 'Bestanden',
  fehlgeschlagen: 'Fehlgeschlagen',
  gesperrt: 'Gesperrt',
};

export default function Summary({ levels, updatedAt }: Props) {
  const reached = reachedLevel(levels);

  return (
    <section className="summary" aria-label="Zusammenfassung">
      <div className="summary-left">
        <div className="summary-label">Erreichtes Level</div>
        <div className="summary-value" data-testid="summary-reached">
          {reached} <span className="summary-total">/ 10</span>
        </div>
      </div>
      <div className="summary-right">
        <div
          className="progress"
          role="img"
          aria-label={`${reached} von 10 Levels erreicht`}
          data-testid="summary-progress"
        >
          {levels.map((level) => (
            <span
              key={level.level}
              className={`segment status-${level.status}`}
              title={`Level ${level.level}: ${LABELS[level.status]}`}
            />
          ))}
        </div>
        <div className="summary-updated">
          Zuletzt aktualisiert: <span className="mono" data-testid="summary-updated">{formatDate(updatedAt)}</span>
        </div>
      </div>
    </section>
  );
}

import type { LoadState } from '../results';

interface Props {
  state: Exclude<LoadState, 'loading' | 'ok'>;
}

const TEXTS: Record<Props['state'], string> = {
  missing: 'Keine Ergebnisse gefunden. Die Datei results.json fehlt.',
  invalid: 'Die Ergebnisdatei ist ungültig. Es werden keine Ergebnisse angezeigt.',
  unavailable: 'Backend nicht erreichbar. Neuer Versuch alle 5 Sekunden.',
};

export default function Notice({ state }: Props) {
  return (
    <div className="notice" role="alert" data-testid="notice" data-kind={state}>
      <span className="notice-icon" aria-hidden="true">!</span>
      <span>{TEXTS[state]}</span>
    </div>
  );
}

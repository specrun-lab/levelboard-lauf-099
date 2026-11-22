import type { Run, Source } from '../results';

interface Props {
  run: Run;
  source: Source;
  loaded: boolean;
}

export default function Header({ run, source, loaded }: Props) {
  const sourceText = !loaded ? '–' : source === 'api' ? 'Backend' : 'Datei';
  const sourceValue = loaded ? source ?? '' : '';
  const commitShort = run.commit === null ? '–' : run.commit.slice(0, 7);

  return (
    <header className="header">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true">▮▮▮</span>
        <span className="brand-name">Levelboard</span>
      </div>
      <dl className="header-meta">
        <div className="meta-pair">
          <dt>Durchlauf</dt>
          <dd data-testid="run-id">{run.id}</dd>
        </div>
        <div className="meta-pair">
          <dt>Version</dt>
          <dd data-testid="run-version">{run.version}</dd>
        </div>
        <div className="meta-pair">
          <dt>Commit</dt>
          <dd data-testid="run-commit" title={run.commit ?? undefined}>{commitShort}</dd>
        </div>
        <div className="meta-pair">
          <dt>Quelle</dt>
          <dd data-testid="run-source" data-source={sourceValue}>{sourceText}</dd>
        </div>
      </dl>
    </header>
  );
}

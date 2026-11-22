import { useEffect, useState } from 'react';
import Header from './components/Header';
import Notice from './components/Notice';
import Summary from './components/Summary';
import LevelCard from './components/LevelCard';
import Report from './components/Report';
import { emptyResults, parseResults } from './results';
import type { LoadState, Results, Source } from './results';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export default function App() {
  const [source, setSource] = useState<Source>(null);
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<Results>(emptyResults());

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await fetch('/config.json', { cache: 'no-store' });
        const contentType = response.headers.get('content-type') || '';
        if (response.ok && !contentType.includes('text/html')) {
          const config: unknown = await response.json();
          if (isRecord(config) && config.source === 'api') {
            if (active) setSource('api');
            return;
          }
        }
      } catch {
        // Keine Konfiguration vorhanden: Datei-Modus.
      }
      if (active) setSource('file');
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (source === null) return;
    let cancelled = false;
    let timer: number | undefined;

    const apply = (parsed: Results | null) => {
      if (cancelled) return;
      if (parsed === null) {
        setState('invalid');
      } else {
        setData(parsed);
        setState('ok');
      }
    };

    if (source === 'file') {
      setState('loading');
      (async () => {
        try {
          const response = await fetch('/results.json', { cache: 'no-store' });
          const contentType = response.headers.get('content-type') || '';
          if (!response.ok) {
            setState(response.status === 404 ? 'missing' : 'invalid');
            return;
          }
          if (contentType.includes('text/html')) {
            setState('missing');
            return;
          }
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            setState('invalid');
            return;
          }
          apply(parseResults(body));
        } catch {
          if (!cancelled) setState('missing');
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    setState('loading');
    const poll = async () => {
      try {
        const response = await fetch('/api/levels', { cache: 'no-store' });
        const contentType = response.headers.get('content-type') || '';
        if (!response.ok || contentType.includes('text/html')) {
          if (!cancelled) setState('unavailable');
        } else {
          let body: unknown;
          try {
            body = await response.json();
          } catch {
            if (!cancelled) setState('invalid');
            return;
          }
          apply(parseResults(body));
        }
      } catch {
        if (!cancelled) setState('unavailable');
      } finally {
        if (!cancelled) timer = window.setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [source]);

  const shown = state === 'ok' ? data : emptyResults();

  return (
    <div className="app" data-testid="board" data-state={state}>
      <Header run={shown.run} source={source} loaded={source !== null} />
      <main className="main">
        {(state === 'missing' || state === 'invalid' || state === 'unavailable') && <Notice state={state} />}
        <Summary levels={shown.levels} updatedAt={shown.run.updatedAt} />
        <section className="cards" aria-label="Levels">
          {shown.levels.map((level, index) => (
            <LevelCard key={level.level} level={level} index={index} />
          ))}
        </section>
        <Report levels={shown.levels} run={shown.run} />
      </main>
    </div>
  );
}

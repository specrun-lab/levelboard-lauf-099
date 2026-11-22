import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return Math.round(sorted[index - 1]);
}

export async function loadtest(base) {
  const root = base.replace(/\/$/, '');
  const connections = 10;
  const durationMs = 30_000;
  const start = performance.now();
  const times = [];
  let requests = 0;
  let errors = 0;

  const loop = async () => {
    let toggle = 0;
    while (performance.now() - start < durationMs) {
      const path = toggle === 0 ? '/' : '/api/levels';
      toggle = 1 - toggle;
      const t0 = performance.now();
      let ok = false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await fetch(root + path, { signal: controller.signal });
          await response.arrayBuffer();
          ok = response.status === 200;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        ok = false;
      }
      const elapsed = performance.now() - t0;
      times.push(elapsed);
      requests += 1;
      if (!ok) errors += 1;
    }
  };

  await Promise.all(Array.from({ length: connections }, () => loop()));
  const elapsedS = (performance.now() - start) / 1000;
  const sorted = [...times].sort((a, b) => a - b);

  return {
    connections,
    durationS: 30,
    requests,
    errors,
    rps: Math.round((requests / elapsedS) * 10) / 10,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    maxMs: sorted.length > 0 ? Math.round(sorted[sorted.length - 1]) : 0,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2];
  if (!base) {
    console.error('Aufruf: node loadtest.mjs <basis-url>');
    process.exit(1);
  }
  try {
    const result = await loadtest(base);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

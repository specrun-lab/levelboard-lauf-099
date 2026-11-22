import fs from 'node:fs';

const [file, base] = process.argv.slice(2);
if (!file || !base) {
  console.error('Aufruf: node report-live.mjs <results.json> <basis-url>');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (error) {
  console.error(`Ergebnisdatei nicht lesbar: ${error.message}`);
  process.exit(1);
}

const root = base.replace(/\/$/, '');
let reported = 0;

for (const level of data.levels || []) {
  if (!Array.isArray(level.checks) || level.checks.length === 0) break;
  if (level.status !== 'bestanden' && level.status !== 'fehlgeschlagen') break;

  let response;
  try {
    response = await fetch(`${root}/api/levels/${level.level}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        checks: level.checks,
        durationMs: level.durationMs,
        metrics: level.metrics || {},
      }),
    });
  } catch (error) {
    console.error(`Meldung an die Live-API für Level ${level.level} fehlgeschlagen: ${error.message}`);
    process.exit(1);
  }
  if (!response.ok) {
    const text = (await response.text()).trim();
    console.error(`Meldung an die Live-API für Level ${level.level} fehlgeschlagen: ${response.status} ${text}`);
    process.exit(1);
  }
  reported += 1;
  if (level.status === 'fehlgeschlagen') break;
}

if (reported === 0) {
  console.error('Keine Level gemeldet');
  process.exit(1);
}

console.log(`${reported} Level an die Live-API gemeldet`);

import { execFileSync } from 'node:child_process';

function ghApi(url) {
  return JSON.parse(execFileSync('gh', ['api', url], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
}

function seconds(from, to) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 1000);
}

export async function pipelineOf(repo, sha) {
  if (!repo) throw new Error('GITHUB_REPO fehlt');
  if (!sha) throw new Error('Commit fehlt');
  const runs = ghApi(`repos/${repo}/actions/workflows/ci.yml/runs?branch=main&head_sha=${sha}&per_page=1`);
  const run = runs.workflow_runs?.[0];
  if (!run) throw new Error('Kein CI-Lauf für den Commit gefunden');
  const jobData = ghApi(`repos/${repo}/actions/runs/${run.id}/jobs`);
  const jobs = {};
  let latest = Date.parse(run.run_started_at);
  for (const job of jobData.jobs || []) {
    if (job.status !== 'completed' || !job.started_at || !job.completed_at) continue;
    jobs[job.name] = seconds(job.started_at, job.completed_at);
    latest = Math.max(latest, Date.parse(job.completed_at));
  }
  return { runId: run.id, url: run.html_url, jobs, totalS: Math.round((latest - Date.parse(run.run_started_at)) / 1000) };
}

const MANIFEST_ACCEPT = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
].join(', ');

export async function imageSizeMB(name, tag) {
  if (!name || !tag) throw new Error('Name oder Tag fehlt');
  const scope = `repository:${name}:pull`;
  const tokenResponse = await fetch(`https://ghcr.io/token?scope=${encodeURIComponent(scope)}`);
  if (!tokenResponse.ok) throw new Error(`GHCR-Token nicht erhalten: ${tokenResponse.status}`);
  const tokenData = await tokenResponse.json();
  if (!tokenData.token) throw new Error('GHCR-Token leer');
  const headers = { Authorization: `Bearer ${tokenData.token}`, Accept: MANIFEST_ACCEPT };
  const url = `https://ghcr.io/v2/${name}/manifests/${tag}`;
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Manifest nicht erhalten: ${response.status}`);
  let manifest = await response.json();
  if (Array.isArray(manifest.manifests)) {
    const candidate = manifest.manifests.find(
      (entry) => entry.platform?.os === 'linux' && entry.platform?.architecture === 'amd64',
    );
    if (!candidate) throw new Error('Kein linux/amd64-Eintrag im Image-Index');
    const selected = await fetch(`https://ghcr.io/v2/${name}/manifests/${candidate.digest}`, { headers });
    if (!selected.ok) throw new Error(`Manifest nicht erhalten: ${selected.status}`);
    manifest = await selected.json();
  }
  const bytes = (manifest.layers || []).reduce((sum, layer) => sum + (layer.size || 0), 0);
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

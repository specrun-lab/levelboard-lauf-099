import fs from 'node:fs';
import path from 'node:path';

const PRICES = {
  'claude-opus-5-5': { input: 4, cacheWrite5m: 5, cacheWrite1h: 8, cacheRead: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cacheWrite5m: 2.5, cacheWrite1h: 4, cacheRead: 0.1, output: 10 },
  'claude-haiku-5-5': { input: 0.1, cacheWrite5m: 0.125, cacheWrite1h: 0.2, cacheRead: 0.01, output: 0.5 },
  'claude-haiku-5-5:long': { input: 0.5, cacheWrite5m: 0.625, cacheWrite1h: 1, cacheRead: 0.05, output: 2.5 },
};

function listLogs(dir) {
  const result = [];
  if (!dir || !fs.existsSync(dir)) return result;
  const walk = (folder) => {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.jsonl')) result.push(full);
    }
  };
  walk(dir);
  return result;
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function number(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function iso(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function zeroToken() {
  return {
    models: [],
    responses: 0,
    input: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    output: 0,
    total: 0,
    costUsd: 0,
    from: null,
    until: null,
    buildS: 0,
  };
}

function tokenObject(phase, phaseStart) {
  if (phase.length === 0) return null;
  const sorted = [...phase].sort((a, b) => a.timestamp - b.timestamp);
  const models = new Set();
  let input = 0;
  let cacheWrite5m = 0;
  let cacheWrite1h = 0;
  let cacheRead = 0;
  let output = 0;
  let cost = 0;

  for (const response of sorted) {
    const usage = response.usage || {};
    models.add(response.model);
    const inTokens = number(usage.input_tokens);
    const creation = usage.cache_creation || {};
    const write5m = number(creation.ephemeral_5m_input_tokens ?? usage.cache_creation_input_tokens);
    const write1h = number(creation.ephemeral_1h_input_tokens);
    const read = number(usage.cache_read_input_tokens);
    const out = number(usage.output_tokens);
    input += inTokens;
    cacheWrite5m += write5m;
    cacheWrite1h += write1h;
    cacheRead += read;
    output += out;

    const price = PRICES[response.model];
    if (!price) throw new Error(`Unbekanntes Modell: ${response.model}`);
    const promptLength = inTokens + number(usage.cache_creation_input_tokens) + read;
    const tier = response.model === 'claude-haiku-5-5' && promptLength > 100000 ? PRICES['claude-haiku-5-5:long'] : price;
    cost +=
      (inTokens * tier.input +
        write5m * tier.cacheWrite5m +
        write1h * tier.cacheWrite1h +
        read * tier.cacheRead +
        out * tier.output) /
      1000000;
  }

  const first = sorted[0].timestamp;
  const last = sorted[sorted.length - 1].timestamp;
  const start = Number.isFinite(phaseStart) ? phaseStart : first;
  return {
    models: [...models].sort(),
    responses: sorted.length,
    input,
    cacheWrite5m,
    cacheWrite1h,
    cacheRead,
    output,
    total: input + cacheWrite5m + cacheWrite1h + cacheRead + output,
    costUsd: Math.round(cost * 100) / 100,
    from: iso(first),
    until: iso(last),
    buildS: Math.max(0, Math.round((last - start) / 1000)),
  };
}

export function levelTokens(current, dir = path.join(process.env.HOME || '', '.claude', 'projects')) {
  const responses = [];
  const outputs = [];
  const commands = new Map();
  const seenIds = new Set();

  for (const file of listLogs(dir)) {
    let text = '';
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      if (entry.type === 'assistant' && entry.message && entry.message.usage) {
        const id = entry.message.id;
        if (id !== undefined && seenIds.has(id)) continue;
        if (id !== undefined) seenIds.add(id);
        if (entry.message.model === '<synthetic>') continue;
        responses.push({
          timestamp: Date.parse(entry.timestamp),
          model: entry.message.model || '',
          usage: entry.message.usage,
        });
        for (const block of entry.message.content || []) {
          if (block && block.type === 'tool_use' && block.name === 'Bash') {
            commands.set(block.id, (block.input && block.input.command) || '');
          }
        }
      } else if (entry.type === 'user') {
        const result = entry.toolUseResult;
        let commandId = null;
        let output = null;
        if (result && (typeof result.stdout === 'string' || typeof result.stderr === 'string')) {
          const blocks = entry.message?.content || [];
          const first = blocks.find((block) => block && block.type === 'tool_result');
          if (first && first.tool_use_id) {
            commandId = first.tool_use_id;
            output = (result.stdout || '') + '\n' + (result.stderr || '');
          }
        }
        const textContent = messageText(entry.message?.content);
        if (!commandId && textContent.includes('<task-notification>')) {
          const match = textContent.match(/<tool-use-id>([\s\S]*?)<\/tool-use-id>/);
          if (match) {
            commandId = match[1].trim();
            output = textContent;
          }
        }
        if (commandId !== null && output !== null) {
          outputs.push({ timestamp: Date.parse(entry.timestamp), commandId, output });
        }
      }
    }
  }

  responses.sort((a, b) => a.timestamp - b.timestamp);
  outputs.sort((a, b) => a.timestamp - b.timestamp);

  const boundaries = [];
  let best = 0;
  for (const item of outputs) {
    const command = commands.get(item.commandId) || '';
    if (!/make\s+check\b/.test(command)) continue;
    const reported = new Set(
      [...item.output.matchAll(/Level\s+(\d+):\s*bestanden/g)].map((match) => Number(match[1])),
    );
    let reached = 0;
    for (let level = 1; level <= 10; level += 1) {
      if (!reported.has(level)) break;
      reached = level;
    }
    if (reached > best) {
      boundaries.push({ timestamp: item.timestamp, from: best + 1, to: reached });
      best = reached;
    }
  }

  const checked = (Array.isArray(current) ? current : [])
    .filter((level) => level && (level.status === 'bestanden' || level.status === 'fehlgeschlagen'))
    .sort((a, b) => a.level - b.level);
  let currentBest = 0;
  for (const level of checked) {
    if (level.status !== 'bestanden' || level.level !== currentBest + 1) break;
    currentBest = level.level;
  }
  const currentFailed = checked.find((level) => level.status === 'fehlgeschlagen' && level.level > best);

  const assignments = new Map();
  let previous = -Infinity;
  for (const boundary of boundaries) {
    const phase = responses.filter((response) => response.timestamp > previous && response.timestamp <= boundary.timestamp);
    const token = tokenObject(phase, previous);
    if (token) assignments.set(boundary.to, token);
    for (let level = boundary.from; level < boundary.to; level += 1) {
      assignments.set(level, { inLevel: boundary.to });
    }
    previous = boundary.timestamp;
  }

  const rest = responses.filter((response) => response.timestamp > previous);
  if (currentBest > best) {
    const token = tokenObject(rest, previous);
    if (token) assignments.set(currentBest, token);
    for (let level = best + 1; level < currentBest; level += 1) {
      assignments.set(level, { inLevel: currentBest });
    }
    if (currentFailed) assignments.set(currentFailed.level, zeroToken());
  } else if (currentFailed) {
    const token = tokenObject(rest, previous);
    if (token) assignments.set(currentFailed.level, token);
  }

  const result = {};
  for (const level of checked) {
    if (assignments.has(level.level)) result[level.level] = assignments.get(level.level);
  }
  return result;
}

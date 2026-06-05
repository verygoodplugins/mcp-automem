import fs from 'fs';
import os from 'os';
import path from 'path';
import fetch from 'node-fetch';
import { AutoMemClient } from '../automem-client.js';
import { readAutoMemApiKeyFromEnv } from '../env.js';
import type { AssociateMemoryArgs, StoreMemoryArgs } from '../types.js';

interface QueueOptions {
  filePath?: string;
  dryRun?: boolean;
  limit?: number;
}

function parseQueueArgs(args: string[]): QueueOptions {
  const options: QueueOptions = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    switch (arg) {
      case '--file':
      case '-f':
        options.filePath = args[i + 1];
        i += 1;
        break;
      case '--dry-run':
        options.dryRun = true;
        break;
      case '--limit':
        options.limit = Number.parseInt(args[i + 1] ?? '', 10) || undefined;
        i += 1;
        break;
      default:
        break;
    }
  }
  return options;
}

function normalizeTags(tags: unknown): string[] {
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((tag) => `${tag}`.trim()).filter(Boolean);
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function ensureObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...value } as Record<string, unknown>;
  }
  return {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

type AutoMemConfig = { endpoint: string; apiKey?: string };

function parseTomlString(value: string): string | undefined {
  const trimmed = value.trim();
  const quoted = trimmed.match(/^(['"])([\s\S]*)\1$/);
  if (quoted) {
    return quoted[2]
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\\\/g, '\\');
  }
  return trimmed.length > 0 ? trimmed : undefined;
}

function readCodexAutoMemConfig(): AutoMemConfig | null {
  const codexHome = process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex');
  const configPath = path.join(codexHome, 'config.toml');
  if (!fs.existsSync(configPath)) {
    return null;
  }

  try {
    const lines = fs.readFileSync(configPath, 'utf8').split(/\r?\n/);
    let inMcpEnvSection = false;
    let endpoint: string | undefined;
    let apiKey: string | undefined;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) {
        continue;
      }

      const section = line.match(/^\[([^\]]+)\]$/);
      if (section) {
        inMcpEnvSection = /^mcp_servers\.[^.]+\.env$/.test(section[1]);
        continue;
      }

      if (!inMcpEnvSection) {
        continue;
      }

      const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
      if (!assignment) {
        continue;
      }

      const key = assignment[1];
      const value = parseTomlString(assignment[2]);
      if (key === 'AUTOMEM_API_URL' || key === 'AUTOMEM_ENDPOINT') {
        endpoint = value;
      } else if (key === 'AUTOMEM_API_KEY' || key === 'AUTOMEM_API_TOKEN') {
        apiKey = value;
      }
    }

    if (endpoint || apiKey) {
      return {
        endpoint: endpoint ?? 'http://127.0.0.1:8001',
        apiKey,
      };
    }
  } catch {
    // Ignore read/parse errors and use the next config source.
  }

  return null;
}

function resolveAutoMemConfig(): AutoMemConfig {
  const envEndpoint = process.env.AUTOMEM_API_URL ?? process.env.AUTOMEM_ENDPOINT;
  const envApiKey = readAutoMemApiKeyFromEnv();

  if (envEndpoint || envApiKey) {
    return {
      endpoint: envEndpoint ?? 'http://127.0.0.1:8001',
      apiKey: envApiKey,
    };
  }

  const codexConfig = readCodexAutoMemConfig();
  if (codexConfig) {
    return codexConfig;
  }

  try {
    const configPath = path.join(os.homedir(), '.claude.json');
    if (!fs.existsSync(configPath)) {
      return { endpoint: 'http://127.0.0.1:8001' };
    }
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      mcpServers?: Record<string, { env?: NodeJS.ProcessEnv }>;
    };
    const servers = parsed?.mcpServers ?? {};
    for (const server of Object.values(servers)) {
      const env = server?.env ?? {};
      const keyFromServerEnv = readAutoMemApiKeyFromEnv(env);
      const serverEndpoint = env.AUTOMEM_API_URL ?? env.AUTOMEM_ENDPOINT;
      if (serverEndpoint || keyFromServerEnv) {
        return {
          endpoint: serverEndpoint ?? 'http://127.0.0.1:8001',
          apiKey: keyFromServerEnv,
        };
      }
    }
  } catch {
    // Ignore read/parse errors and use defaults.
  }

  return { endpoint: 'http://127.0.0.1:8001' };
}

async function isEndpointHealthy(endpoint: string): Promise<boolean> {
  const url = `${endpoint.replace(/\/$/, '')}/health`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function runQueueCommand(args: string[] = []): Promise<void> {
  const options = parseQueueArgs(args);
  const queuePath = path.resolve(
    options.filePath ?? path.join(os.homedir(), '.claude', 'scripts', 'memory-queue.jsonl')
  );

  if (!fs.existsSync(queuePath)) {
    console.log(`Queue file not found at ${queuePath}. Nothing to do.`);
    return;
  }

  const lines = fs
    .readFileSync(queuePath, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    console.log('Memory queue empty.');
    return;
  }

  const config = resolveAutoMemConfig();
  const healthy = await isEndpointHealthy(config.endpoint);
  if (!healthy) {
    console.log('AutoMem endpoint unavailable; skipping queue drain.');
    return;
  }

  const client = new AutoMemClient({
    endpoint: config.endpoint,
    apiKey: config.apiKey,
  });

  const remaining: string[] = [];
  const associations: Array<{ source: string; target: string; type?: string; strength?: number }> = [];
  let storedCount = 0;
  let skippedCount = 0;

  for (const line of lines.slice(0, options.limit ?? lines.length)) {
    let parsed: Record<string, unknown>;
    try {
      const rawParsed = JSON.parse(line) as unknown;
      if (!isRecord(rawParsed)) {
        console.warn('Skipping queue entry that is not an object');
        skippedCount += 1;
        continue;
      }
      parsed = rawParsed;
    } catch (error) {
      console.warn('Skipping invalid queue entry:', error);
      skippedCount += 1;
      continue;
    }

    const content = typeof parsed.content === 'string' ? parsed.content.trim() : '';
    if (!content) {
      console.warn('Skipping queue entry without content');
      skippedCount += 1;
      continue;
    }

    const metadata = ensureObject(parsed.metadata);
    const record: StoreMemoryArgs = {
      content,
      type: typeof parsed.type === 'string' ? parsed.type as StoreMemoryArgs['type'] : undefined,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      tags: normalizeTags(parsed.tags ?? metadata.tags),
      importance: typeof parsed.importance === 'number' ? parsed.importance : undefined,
      metadata,
      timestamp: typeof parsed.timestamp === 'string' ? parsed.timestamp : undefined,
      t_valid: typeof parsed.t_valid === 'string' ? parsed.t_valid : undefined,
      t_invalid: typeof parsed.t_invalid === 'string' ? parsed.t_invalid : undefined,
      embedding: Array.isArray(parsed.embedding) ? parsed.embedding : undefined,
    };

    if (options.dryRun) {
      console.log(`[dry-run] would store memory: ${content.slice(0, 80)}...`);
      storedCount += 1;
      continue;
    }

    try {
      const result = await client.storeMemory(record);
      console.log(`Stored memory ${result.memory_id ?? ''}`);
      storedCount += 1;

      if (typeof parsed.relatesTo === 'string') {
        associations.push({
          source: parsed.relatesTo,
          target: result.memory_id ?? '',
          type: typeof parsed.relationshipType === 'string' ? parsed.relationshipType : undefined,
          strength: typeof parsed.relationshipStrength === 'number' ? parsed.relationshipStrength : undefined,
        });
      }
    } catch (error) {
      console.error('Failed to store memory:', (error as Error).message);
      remaining.push(line);
    }
  }

  // Append untouched lines (when limit smaller than queue)
  if ((options.limit ?? lines.length) < lines.length) {
    remaining.push(...lines.slice(options.limit ?? lines.length));
  }

  if (!options.dryRun) {
    for (const relation of associations) {
      if (!relation.source || !relation.target) continue;
      try {
        const relationType = (relation.type ?? 'RELATES_TO').toString().toUpperCase() as AssociateMemoryArgs['type'];
        await client.associateMemories({
          memory1_id: relation.source,
          memory2_id: relation.target,
          type: relationType,
          strength: relation.strength ?? 0.5,
        });
      } catch (error) {
        console.warn('Failed to create relationship:', (error as Error).message);
      }
    }
  }

  if (!options.dryRun) {
    if (remaining.length === 0) {
      try {
        fs.unlinkSync(queuePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
        // File already deleted (race condition) - ignore
      }
    } else {
      fs.writeFileSync(`${queuePath}`, `${remaining.join('\n')}\n`, 'utf8');
    }
  }

  console.log(`Queue processing complete. Stored: ${storedCount}, skipped: ${skippedCount}, remaining: ${remaining.length}`);
}

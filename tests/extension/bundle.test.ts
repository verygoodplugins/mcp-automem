import { afterAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync } from 'fflate';
import { startFakeAutoMemApi, StdioMcpClient } from '../helpers/host-smoke.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bytes = fs.readFileSync(path.join(root, 'artifacts/mcp-automem.mcpb'));
const files = unzipSync(bytes);
const manifest = JSON.parse(Buffer.from(files['manifest.json']).toString());
const pkg = JSON.parse(Buffer.from(files['package.json']).toString());
const expected = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-bundle-test-'));
afterAll(() => fs.rmSync(isolated, { recursive: true, force: true }));

describe('Claude Desktop release bundle', () => {
  it('has matching versions, runtime, checksum and a production-only payload', () => {
    expect(manifest.version).toBe(expected.version);
    expect(pkg.version).toBe(expected.version);
    expect(manifest.compatibility.runtimes.node).toBe(expected.engines.node);
    expect(files[manifest.server.entry_point]).toBeDefined();
    expect(files[manifest.icon]).toBeDefined();
    const digest = createHash('sha256').update(bytes).digest('hex');
    expect(fs.readFileSync(path.join(root, 'artifacts/mcp-automem.mcpb.sha256'), 'utf8')).toBe(
      `${digest}  mcp-automem.mcpb\n`
    );
    const allowedRoots = new Set([
      'node_modules',
      'package.json',
      ...expected.files.map((file: string) => file.replace(/\/$/, '')),
    ]);
    for (const name of Object.keys(files)) {
      expect(allowedRoots.has(name.split('/')[0]), name).toBe(true);
      expect(/(^|\/)\.env(?:\.|$)|\.mcpb$|\.node$/.test(name), name).toBe(false);
    }
    // Some dev dependencies are also production peers (e.g. @types/node).
    // Reject every package the lockfile marks exclusively development-only.
    for (const [dependency, metadata] of Object.entries(lock.packages)) {
      if ((metadata as { dev?: boolean }).dev) {
        expect(`${dependency}/package.json` in files, dependency).toBe(false);
      }
    }
  });

  it('launches the extracted manifest command and calls the fake API over MCP', async () => {
    for (const [name, content] of Object.entries(files)) {
      const target = path.join(isolated, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    const fake = await startFakeAutoMemApi();
    const variables: Record<string, string> = {
      __dirname: isolated,
      'user_config.automem_api_url': fake.url,
      'user_config.automem_api_key': 'bundle-test-key',
    };
    const interpolate = (value: string) =>
      value.replace(/\$\{([^}]+)\}/g, (_, key) => {
        if (!(key in variables)) throw new Error(`Unknown manifest variable: ${key}`);
        return variables[key];
      });
    expect(manifest.server.mcp_config.command).toBe('node');
    const client = new StdioMcpClient(
      process.execPath,
      manifest.server.mcp_config.args.map(interpolate),
      {
        PATH: process.env.PATH,
        HOME: isolated,
        USERPROFILE: isolated,
        SystemRoot: process.env.SystemRoot,
        ...Object.fromEntries(
          Object.entries(manifest.server.mcp_config.env).map(([key, value]) => [
            key,
            interpolate(value as string),
          ])
        ),
      },
      isolated
    );
    try {
      const initialized = await client.initialize();
      expect(initialized.serverInfo).toMatchObject({ version: expected.version });
      const listed = await client.request('tools/list');
      expect(listed.tools.map((tool: { name: string }) => tool.name)).toEqual(
        manifest.tools.map((tool: { name: string }) => tool.name)
      );
      const recalled = await client.request('tools/call', {
        name: 'recall_memory',
        arguments: { query: 'bundle smoke', limit: 1 },
      });
      expect(recalled.isError).not.toBe(true);
      expect(recalled.structuredContent.count).toBe(1);
      expect(fake.requests).toEqual([
        expect.objectContaining({
          path: '/recall?query=bundle+smoke&limit=1',
          authorization: 'Bearer bundle-test-key',
        }),
      ]);
      expect(client.invalidStdoutLines).toEqual([]);
    } finally {
      await client.close();
      await fake.close();
    }
  }, 30_000);
});

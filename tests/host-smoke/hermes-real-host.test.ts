import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { applyHermesSetup } from '../../src/cli/hermes.js';
import { runUninstall } from '../../src/cli/uninstall.js';
import {
  duplicateCounts,
  hermesPythonPath,
  localMcpServerCommand,
  startFakeAutoMemApi,
  type FakeAutoMemApi,
} from '../helpers/host-smoke.js';

const REPO_ROOT = path.resolve(__dirname, '../..');
const HERMES_PYTHON = hermesPythonPath();
const execFileAsync = promisify(execFile);
const EXPECTED_MCP_TOOLS = [
  'mcp_automem_associate_memories',
  'mcp_automem_check_database_health',
  'mcp_automem_recall_memory',
  'mcp_automem_store_memory',
  'mcp_automem_update_memory',
].sort();
const EXPECTED_PROVIDER_TOOLS = [
  'automem_associate_memories',
  'automem_check_database_health',
  'automem_recall_memory',
  'automem_store_memory',
  'automem_update_memory',
].sort();

function configureHermesMcpServerForLocalSource(home: string, fakeApi: FakeAutoMemApi): void {
  const configPath = path.join(home, 'config.yaml');
  const parsed = JSON.parse(JSON.stringify(parseYaml(fs.readFileSync(configPath, 'utf8')))) as {
    mcp_servers?: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  };
  if (!parsed.mcp_servers) return;

  const localServer = localMcpServerCommand(REPO_ROOT);
  for (const name of ['automem', 'memory']) {
    const server = parsed.mcp_servers[name];
    if (!server) continue;
    const serialized = JSON.stringify(server);
    if (!serialized.includes('@verygoodplugins/mcp-automem')) continue;
    server.command = localServer.command;
    server.args = [...localServer.args];
    server.env = {
      ...server.env,
      AUTOMEM_API_URL: fakeApi.url,
      AUTOMEM_API_KEY: 'test-key',
      DOTENV_CONFIG_QUIET: 'true',
    };
  }
  fs.writeFileSync(configPath, stringifyYaml(parsed), 'utf8');
}

async function inspectHermesTools(home: string): Promise<{
  discovered: string[];
  openaiNames: string[];
  anthropicOAuthNames: string[];
  providerNames: string[];
  providerTools: string[];
}> {
  if (!HERMES_PYTHON) {
    throw new Error('Hermes Python is not available');
  }

  const script = String.raw`
import collections
import json
import logging
import os

from hermes_cli.env_loader import load_hermes_dotenv
from tools.mcp_tool import discover_mcp_tools, shutdown_mcp_servers
from hermes_cli.prompt_size import _build_inspection_agent
from agent.anthropic_adapter import build_anthropic_kwargs

logging.disable(logging.CRITICAL)
load_hermes_dotenv(hermes_home=os.environ.get("HERMES_HOME"))

agent = None
try:
    discovered = discover_mcp_tools()
    agent = _build_inspection_agent("cli")
    openai_names = [
        t.get("function", {}).get("name")
        for t in (getattr(agent, "tools", None) or [])
    ]
    kwargs = build_anthropic_kwargs(
        model="claude-opus-4-8",
        messages=[{"role": "user", "content": "hello"}],
        tools=getattr(agent, "tools", None) or [],
        max_tokens=1024,
        reasoning_config=None,
        is_oauth=True,
    )
    manager = getattr(agent, "_memory_manager", None)
    providers = []
    provider_tools = []
    if manager:
        providers = [provider.name for provider in manager.providers]
        provider_tools = [schema.get("name") for schema in manager.get_all_tool_schemas()]
    print(json.dumps({
        "discovered": discovered,
        "openaiNames": openai_names,
        "anthropicOAuthNames": [tool.get("name") for tool in kwargs.get("tools", [])],
        "providerNames": providers,
        "providerTools": provider_tools,
    }))
finally:
    if agent:
        try:
            agent.shutdown_memory_provider()
        except Exception:
            pass
    try:
        shutdown_mcp_servers()
    except Exception:
        pass
`;

  const { stdout } = await execFileAsync(HERMES_PYTHON, ['-c', script], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 10,
    env: {
      ...process.env,
      HERMES_HOME: home,
      HERMES_IGNORE_RULES: 'true',
      AUTOMEM_API_KEY: '',
      AUTOMEM_API_TOKEN: '',
      DOTENV_CONFIG_QUIET: 'true',
    },
  });
  const lastJsonLine = stdout.trim().split(/\r?\n/).reverse().find((line) => line.startsWith('{'));
  if (!lastJsonLine) {
    throw new Error(`Hermes inspection did not emit JSON:\n${stdout}`);
  }
  return JSON.parse(lastJsonLine);
}

async function inspectHermesOfflineTurn(home: string): Promise<{
  toolNames: string[];
  duplicateToolNames: Record<string, number>;
  memoryContext: string;
}> {
  if (!HERMES_PYTHON) {
    throw new Error('Hermes Python is not available');
  }

  const script = String.raw`
import collections
import json
import logging
import os
from types import SimpleNamespace

from hermes_cli.env_loader import load_hermes_dotenv
from tools.mcp_tool import discover_mcp_tools, shutdown_mcp_servers
from hermes_cli.prompt_size import _build_inspection_agent

logging.disable(logging.CRITICAL)
load_hermes_dotenv(hermes_home=os.environ.get("HERMES_HOME"))

agent = None
captured = []
try:
    discover_mcp_tools()
    agent = _build_inspection_agent("cli")
    agent.api_mode = "anthropic_messages"
    agent.provider = "anthropic"
    agent.base_url = "https://api.anthropic.com"
    agent._anthropic_base_url = "https://api.anthropic.com"
    agent._is_anthropic_oauth = True
    agent._disable_streaming = True
    agent.quiet_mode = True

    def fake_api_call(api_kwargs):
        captured.append(api_kwargs)
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text="ok")],
            stop_reason="end_turn",
            usage=SimpleNamespace(input_tokens=1, output_tokens=1),
            model=agent.model,
        )

    agent._interruptible_api_call = fake_api_call
    agent._interruptible_streaming_api_call = lambda api_kwargs, on_first_delta=None: fake_api_call(api_kwargs)
    agent.run_conversation("host smoke hello", conversation_history=[], task_id="host-smoke")
    payload = captured[-1]
    tool_names = [tool.get("name") for tool in payload.get("tools", [])]
    memory_context = ""
    for message in payload.get("messages", []):
        content = message.get("content", "")
        if isinstance(content, str) and "<memory-context>" in content:
            memory_context += content
        elif isinstance(content, list):
            for part in content:
                if isinstance(part, dict) and part.get("type") == "text":
                    text = part.get("text", "")
                    if "<memory-context>" in text:
                        memory_context += text
    print(json.dumps({
        "toolNames": tool_names,
        "duplicateToolNames": {
            name: count for name, count in collections.Counter(tool_names).items() if count > 1
        },
        "memoryContext": memory_context,
    }))
finally:
    if agent:
        try:
            agent.shutdown_memory_provider()
        except Exception:
            pass
    try:
        shutdown_mcp_servers()
    except Exception:
        pass
`;

  const { stdout } = await execFileAsync(HERMES_PYTHON, ['-c', script], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 45_000,
    maxBuffer: 1024 * 1024 * 10,
    env: {
      ...process.env,
      HERMES_HOME: home,
      HERMES_IGNORE_RULES: 'true',
      AUTOMEM_API_KEY: '',
      AUTOMEM_API_TOKEN: '',
      DOTENV_CONFIG_QUIET: 'true',
    },
  });
  const lastJsonLine = stdout.trim().split(/\r?\n/).reverse().find((line) => line.startsWith('{'));
  if (!lastJsonLine) {
    throw new Error(`Hermes offline turn inspection did not emit JSON:\n${stdout}`);
  }
  return JSON.parse(lastJsonLine);
}

async function inspectHermesProviderContract(home: string): Promise<{
  available: boolean;
  prefetch: string;
  toolNames: string[];
  systemPrompt: string;
}> {
  if (!HERMES_PYTHON) {
    throw new Error('Hermes Python is not available');
  }

  const script = String.raw`
import json
import logging
import os

from hermes_cli.env_loader import load_hermes_dotenv
from plugins.memory import load_memory_provider

logging.disable(logging.CRITICAL)
load_hermes_dotenv(hermes_home=os.environ.get("HERMES_HOME"))

provider = load_memory_provider("automem")
if not provider:
    raise RuntimeError("AutoMem provider did not load")

provider.initialize("provider-contract", hermes_home=os.environ.get("HERMES_HOME"), platform="cli", agent_context="primary")
prefetch = provider.prefetch("known query context", session_id="provider-contract")
tools = [schema.get("name") for schema in provider.get_tool_schemas()]
system_prompt = provider.system_prompt_block()
provider.sync_turn(
    "user message long enough to pass the capture length threshold",
    "assistant message long enough to pass the capture length threshold",
    session_id="provider-contract",
)
provider.shutdown()
print(json.dumps({
    "available": provider.is_available(),
    "prefetch": prefetch,
    "toolNames": tools,
    "systemPrompt": system_prompt,
}))
`;

  const { stdout } = await execFileAsync(HERMES_PYTHON, ['-c', script], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 10,
    env: {
      ...process.env,
      HERMES_HOME: home,
      HERMES_IGNORE_RULES: 'true',
      AUTOMEM_API_KEY: '',
      AUTOMEM_API_TOKEN: '',
      DOTENV_CONFIG_QUIET: 'true',
    },
  });
  const lastJsonLine = stdout.trim().split(/\r?\n/).reverse().find((line) => line.startsWith('{'));
  if (!lastJsonLine) {
    throw new Error(`Hermes provider contract did not emit JSON:\n${stdout}`);
  }
  return JSON.parse(lastJsonLine);
}

async function runHermesProviderPrefetchSequence(
  home: string,
  prompts: string[],
  cwd: string = REPO_ROOT,
): Promise<string[]> {
  if (!HERMES_PYTHON) {
    throw new Error('Hermes Python is not available');
  }

  const script = String.raw`
import json
import logging
import os

from hermes_cli.env_loader import load_hermes_dotenv
from plugins.memory import load_memory_provider

logging.disable(logging.CRITICAL)
load_hermes_dotenv(hermes_home=os.environ.get("HERMES_HOME"))

provider = load_memory_provider("automem")
if not provider:
    raise RuntimeError("AutoMem provider did not load")

provider.initialize("provider-prefetch-flow", hermes_home=os.environ.get("HERMES_HOME"), platform="cli", agent_context="primary")
outputs = [
    provider.prefetch(prompt, session_id="provider-prefetch-flow")
    for prompt in json.loads(os.environ["PREFETCH_PROMPTS"])
]
provider.shutdown()
print(json.dumps(outputs))
`;

  const { stdout } = await execFileAsync(HERMES_PYTHON, ['-c', script], {
    encoding: 'utf8',
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 10,
    env: {
      ...process.env,
      HERMES_HOME: home,
      HERMES_IGNORE_RULES: 'true',
      PREFETCH_PROMPTS: JSON.stringify(prompts),
      AUTOMEM_API_KEY: '',
      AUTOMEM_API_TOKEN: '',
      DOTENV_CONFIG_QUIET: 'true',
    },
  });
  const lastJsonLine = stdout.trim().split(/\r?\n/).reverse().find((line) => line.startsWith('['));
  if (!lastJsonLine) {
    throw new Error(`Hermes provider prefetch flow did not emit JSON:\n${stdout}`);
  }
  return JSON.parse(lastJsonLine);
}

async function callHermesProviderRecallTool(home: string): Promise<{
  toolLimitMaximum: number | null;
  recall: string;
}> {
  if (!HERMES_PYTHON) {
    throw new Error('Hermes Python is not available');
  }

  const script = String.raw`
import json
import logging
import os

from hermes_cli.env_loader import load_hermes_dotenv
from plugins.memory import load_memory_provider

logging.disable(logging.CRITICAL)
load_hermes_dotenv(hermes_home=os.environ.get("HERMES_HOME"))

provider = load_memory_provider("automem")
if not provider:
    raise RuntimeError("AutoMem provider did not load")

provider.initialize("provider-recall-tool", hermes_home=os.environ.get("HERMES_HOME"), platform="cli", agent_context="primary")
schemas = provider.get_tool_schemas()
recall_schema = next(schema for schema in schemas if schema.get("name") == "automem_recall_memory")
recall = provider.handle_tool_call(
    "automem_recall_memory",
    {"query": "provider explicit recall", "limit": 50, "format": "detailed"},
)
provider.shutdown()
print(json.dumps({
    "toolLimitMaximum": recall_schema.get("parameters", {}).get("properties", {}).get("limit", {}).get("maximum"),
    "recall": recall,
}))
`;

  const { stdout } = await execFileAsync(HERMES_PYTHON, ['-c', script], {
    encoding: 'utf8',
    cwd: REPO_ROOT,
    timeout: 30_000,
    maxBuffer: 1024 * 1024 * 10,
    env: {
      ...process.env,
      HERMES_HOME: home,
      HERMES_IGNORE_RULES: 'true',
      AUTOMEM_API_KEY: '',
      AUTOMEM_API_TOKEN: '',
      DOTENV_CONFIG_QUIET: 'true',
    },
  });
  const lastJsonLine = stdout.trim().split(/\r?\n/).reverse().find((line) => line.startsWith('{'));
  if (!lastJsonLine) {
    throw new Error(`Hermes provider recall tool did not emit JSON:\n${stdout}`);
  }
  return JSON.parse(lastJsonLine);
}

function recallRequests(fakeApi: FakeAutoMemApi): URL[] {
  return fakeApi.requests
    .filter((request) => request.method === 'GET' && request.path.startsWith('/recall'))
    .map((request) => new URL(request.path, 'http://127.0.0.1'));
}

function setHermesEnv(home: string, key: string, value: string): void {
  const envPath = path.join(home, '.env');
  const lines = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, 'utf8').split(/\r?\n/).filter(Boolean)
    : [];
  const prefix = `${key}=`;
  const next = lines.filter((line) => !line.startsWith(prefix));
  next.push(`${key}=${value}`);
  fs.writeFileSync(envPath, `${next.join('\n')}\n`, 'utf8');
}

function addPreReleaseMemoryMcpServer(home: string): void {
  const configPath = path.join(home, 'config.yaml');
  const parsed = JSON.parse(JSON.stringify(parseYaml(fs.readFileSync(configPath, 'utf8')))) as {
    mcp_servers?: Record<string, unknown>;
  };
  parsed.mcp_servers = parsed.mcp_servers ?? {};
  parsed.mcp_servers.memory = {
    command: 'npx',
    args: ['-y', '@verygoodplugins/mcp-automem'],
    env: {
      AUTOMEM_API_URL: 'http://127.0.0.1:1',
      AUTOMEM_API_KEY: 'test-key',
    },
  };
  fs.writeFileSync(configPath, stringifyYaml(parsed), 'utf8');
}

describe.skipIf(!HERMES_PYTHON)('Hermes real host integration', () => {
  let tmpDir: string;
  let fakeApi: FakeAutoMemApi;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'automem-hermes-host-'));
    fakeApi = await startFakeAutoMemApi();
  });

  afterEach(async () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    await fakeApi.close();
  });

  it.each([
    {
      mode: 'mcp' as const,
      expectedAutomemTools: EXPECTED_MCP_TOOLS,
      expectedProviderTools: [],
      expectedProviders: [],
    },
    {
      mode: 'provider' as const,
      expectedAutomemTools: EXPECTED_PROVIDER_TOOLS,
      expectedProviderTools: EXPECTED_PROVIDER_TOOLS,
      expectedProviders: ['automem'],
    },
    {
      mode: 'both' as const,
      expectedAutomemTools: EXPECTED_MCP_TOOLS,
      expectedProviderTools: [],
      expectedProviders: ['automem'],
    },
  ])(
    '$mode mode exposes unique AutoMem tools through Hermes and Anthropic OAuth conversion',
    async ({ mode, expectedAutomemTools, expectedProviderTools, expectedProviders }) => {
      await applyHermesSetup({
        mode,
        targetDir: tmpDir,
        endpoint: fakeApi.url,
        apiKey: 'test-key',
        projectName: 'host-smoke',
        quiet: true,
      });
      configureHermesMcpServerForLocalSource(tmpDir, fakeApi);

      const inspection = await inspectHermesTools(tmpDir);
      const openaiAutomem = inspection.openaiNames.filter((name) => name.includes('automem')).sort();
      const anthropicAutomem = inspection.anthropicOAuthNames
        .filter((name) => name.includes('automem'))
        .sort();

      expect(openaiAutomem).toEqual(expectedAutomemTools);
      expect(inspection.providerTools.sort()).toEqual(expectedProviderTools);
      expect(inspection.providerNames.sort()).toEqual(expectedProviders);
      expect(duplicateCounts(inspection.openaiNames)).toEqual({});
      expect(duplicateCounts(inspection.anthropicOAuthNames)).toEqual({});
      expect(anthropicAutomem).toEqual(EXPECTED_MCP_TOOLS);

      const turn = await inspectHermesOfflineTurn(tmpDir);
      expect(turn.duplicateToolNames).toEqual({});
      if (mode !== 'mcp') {
        expect(turn.memoryContext).toContain('<memory-context>');
        expect(turn.memoryContext).toContain('remembered host smoke detail');
      } else {
        expect(turn.memoryContext).not.toContain('remembered host smoke detail');
      }
    },
    45_000,
  );

  it('provider contract recalls, honors disabled tools, and keeps auto-capture off by default', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      endpoint: fakeApi.url,
      apiKey: 'test-key',
      projectName: 'host-smoke',
      quiet: true,
    });
    setHermesEnv(tmpDir, 'AUTOMEM_HERMES_PROVIDER_TOOLS', 'false');

    const contract = await inspectHermesProviderContract(tmpDir);

    expect(contract.available).toBe(true);
    expect(contract.prefetch).toContain('remembered host smoke detail');
    expect(contract.toolNames).toEqual([]);
    // Regression: with provider tools disabled (both mode), the system prompt
    // must not direct the agent to the now-unregistered automem_* provider
    // tools — it should point at the MCP surface instead.
    expect(contract.systemPrompt).not.toContain('automem_* tools for intentional');
    expect(contract.systemPrompt).toContain('mcp_automem_*');
    expect(fakeApi.requests.some((request) => request.method === 'POST' && request.path === '/memory')).toBe(false);
  }, 45_000);

  it('provider system prompt advertises automem_* tools only when they are registered', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      endpoint: fakeApi.url,
      apiKey: 'test-key',
      projectName: 'host-smoke',
      quiet: true,
    });

    const contract = await inspectHermesProviderContract(tmpDir);

    // Provider-only mode keeps the explicit tools, so advertising them is correct.
    expect(contract.toolNames).toContain('automem_recall_memory');
    expect(contract.systemPrompt).toContain('automem_* tools for intentional');
  }, 45_000);

  it('provider prefetch follows the shared compact recall blueprint', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      endpoint: fakeApi.url,
      apiKey: 'test-key',
      projectName: 'host-smoke',
      quiet: true,
    });

    const outputs = await runHermesProviderPrefetchSequence(tmpDir, [
      'hi',
      'Hermes AutoMem provider blueprint',
      'What about that approach?',
      'What do you remember about Krakow trip?',
      'Railway deployment status',
      'TimeoutError stack trace failing in provider',
    ]);

    expect(outputs[0]).toBe('');
    expect(outputs[1]).toContain('Preferences');
    expect(outputs[1]).toContain('Task context');
    expect(outputs[2]).toBe('');
    expect(outputs[3]).toContain('Task context');
    expect(outputs[4]).toContain('Task context');
    expect(outputs[5]).toContain('Debug context');

    const recalls = recallRequests(fakeApi);
    expect(recalls).toHaveLength(5);

    const preference = recalls.find((url) => url.searchParams.getAll('tags').includes('preference'));
    expect(preference?.searchParams.get('limit')).toBe('5');
    expect(preference?.searchParams.get('sort')).toBe('updated_desc');
    expect(preference?.searchParams.get('format')).toBe('detailed');
    expect(preference?.searchParams.has('query')).toBe(false);

    const firstContext = recalls.find(
      (url) => url.searchParams.get('query') === 'Hermes AutoMem provider blueprint',
    );
    expect(firstContext?.searchParams.get('limit')).toBe('10');
    expect(firstContext?.searchParams.get('time_query')).toBe('last 90 days');
    expect(firstContext?.searchParams.get('format')).toBe('detailed');
    expect(firstContext?.searchParams.getAll('tags')).toContain('mcp-automem');

    const topicShift = recalls.find(
      (url) => url.searchParams.get('query') === 'Railway deployment status',
    );
    expect(topicShift?.searchParams.get('limit')).toBe('10');
    expect(topicShift?.searchParams.get('time_query')).toBe('last 90 days');
    expect(topicShift?.searchParams.getAll('tags')).toEqual([]);

    const explicit = recalls.find(
      (url) => url.searchParams.get('query') === 'What do you remember about Krakow trip?',
    );
    expect(explicit?.searchParams.get('limit')).toBe('10');
    expect(explicit?.searchParams.get('time_query')).toBe('last 90 days');
    expect(explicit?.searchParams.getAll('tags')).toEqual([]);

    const debug = recalls.find((url) =>
      url.searchParams.get('query')?.startsWith('TimeoutError stack trace failing'),
    );
    expect(debug?.searchParams.get('limit')).toBe('10');
    expect(debug?.searchParams.get('format')).toBe('detailed');
    expect(debug?.searchParams.getAll('tags')).toEqual(['bugfix', 'solution']);
  }, 45_000);

  it('provider prefetch omits ambiguous project gates', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      endpoint: fakeApi.url,
      apiKey: 'test-key',
      projectName: 'host-smoke',
      quiet: true,
    });
    const ambiguousProjectDir = path.join(tmpDir, 'test');
    fs.mkdirSync(ambiguousProjectDir, { recursive: true });

    await runHermesProviderPrefetchSequence(
      tmpDir,
      ['Hermes AutoMem provider blueprint'],
      ambiguousProjectDir,
    );

    const context = recallRequests(fakeApi).find(
      (url) => url.searchParams.get('query') === 'Hermes AutoMem provider blueprint',
    );
    expect(context?.searchParams.get('limit')).toBe('10');
    expect(context?.searchParams.getAll('tags')).toEqual([]);
  }, 45_000);

  it('provider prefetch drops the project gate for general explicit memory asks', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      endpoint: fakeApi.url,
      apiKey: 'test-key',
      projectName: 'host-smoke',
      quiet: true,
    });

    await runHermesProviderPrefetchSequence(tmpDir, ['do we like Example Contact?']);
    await runHermesProviderPrefetchSequence(tmpDir, ['what do we know about mcp-automem Hermes?']);

    const generalContext = recallRequests(fakeApi).find(
      (url) => url.searchParams.get('query') === 'do we like Example Contact?',
    );
    expect(generalContext?.searchParams.get('limit')).toBe('10');
    expect(generalContext?.searchParams.getAll('tags')).toEqual([]);

    const projectContext = recallRequests(fakeApi).find(
      (url) => url.searchParams.get('query') === 'what do we know about mcp-automem Hermes?',
    );
    expect(projectContext?.searchParams.get('limit')).toBe('10');
    expect(projectContext?.searchParams.getAll('tags')).toContain('mcp-automem');
  }, 45_000);

  it('provider explicit recall clamps large limits before calling AutoMem', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      endpoint: fakeApi.url,
      apiKey: 'test-key',
      projectName: 'host-smoke',
      quiet: true,
    });

    const result = await callHermesProviderRecallTool(tmpDir);

    expect(result.toolLimitMaximum).toBe(10);
    expect(result.recall).toContain('remembered host smoke detail');
    expect(
      fakeApi.requests.some(
        (request) =>
          request.method === 'GET' &&
          request.path.startsWith('/recall?') &&
          request.path.includes('query=provider+explicit+recall') &&
          request.path.includes('limit=10'),
      ),
    ).toBe(true);
  }, 45_000);

  it('registers the active provider CLI doctor command', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      endpoint: fakeApi.url,
      apiKey: 'test-key',
      projectName: 'host-smoke',
      quiet: true,
    });

    const { stdout } = await execFileAsync('hermes', ['automem', 'doctor'], {
      encoding: 'utf8',
      cwd: REPO_ROOT,
      timeout: 30_000,
      maxBuffer: 1024 * 1024 * 10,
      env: {
        ...process.env,
        HERMES_HOME: tmpDir,
        AUTOMEM_API_KEY: '',
        AUTOMEM_API_TOKEN: '',
        DOTENV_CONFIG_QUIET: 'true',
      },
    });

    expect(stdout).toContain('AutoMem Hermes provider');
    expect(stdout).toContain('memory.provider:   automem');
    expect(stdout).toContain('health:            ok');
    expect(stdout).toContain('recall prefetch:   ok');
    expect(stdout).toContain('Recall context is injected into the model payload');
  }, 45_000);

  it('debug-recall prints the fenced <memory-context> block recall injects', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      endpoint: fakeApi.url,
      apiKey: 'test-key',
      projectName: 'host-smoke',
      quiet: true,
    });

    const { stdout } = await execFileAsync(
      'hermes',
      ['automem', 'debug-recall', 'what do you remember about my setup?'],
      {
        encoding: 'utf8',
        cwd: REPO_ROOT,
        timeout: 30_000,
        maxBuffer: 1024 * 1024 * 10,
        env: {
          ...process.env,
          HERMES_HOME: tmpDir,
          AUTOMEM_API_KEY: '',
          AUTOMEM_API_TOKEN: '',
          DOTENV_CONFIG_QUIET: 'true',
        },
      },
    );

    // The block is wrapped by Hermes' own build_memory_context_block, so this is
    // byte-for-byte what ambient recall injects ahead of each turn — the surface
    // the docs visual (screenshots/hermes-injected-context.png) captures.
    expect(stdout).toContain('<memory-context>');
    expect(stdout).toContain('</memory-context>');
    // First substantive turn in the session → preference + task-context sections.
    expect(stdout).toContain('Preferences');
    expect(stdout).toContain('remembered host smoke detail');
  }, 45_000);

  it('debug-recall --raw omits the fence but keeps the recalled content', async () => {
    await applyHermesSetup({
      mode: 'provider',
      targetDir: tmpDir,
      endpoint: fakeApi.url,
      apiKey: 'test-key',
      projectName: 'host-smoke',
      quiet: true,
    });

    const { stdout } = await execFileAsync(
      'hermes',
      ['automem', 'debug-recall', '--raw', 'what do you remember about my setup?'],
      {
        encoding: 'utf8',
        cwd: REPO_ROOT,
        timeout: 30_000,
        maxBuffer: 1024 * 1024 * 10,
        env: {
          ...process.env,
          HERMES_HOME: tmpDir,
          AUTOMEM_API_KEY: '',
          AUTOMEM_API_TOKEN: '',
          DOTENV_CONFIG_QUIET: 'true',
        },
      },
    );

    expect(stdout).not.toContain('<memory-context>');
    expect(stdout).toContain('remembered host smoke detail');
  }, 45_000);

  it.each([
    ['provider', 'mcp'],
    ['mcp', 'provider'],
    ['provider', 'both'],
    ['both', 'mcp'],
  ] as const)(
    '%s -> %s leaves a unique provider payload after one offline turn',
    async (firstMode, secondMode) => {
      await applyHermesSetup({
        mode: firstMode,
        targetDir: tmpDir,
        endpoint: fakeApi.url,
        apiKey: 'test-key',
        projectName: 'host-smoke',
        quiet: true,
      });
      await applyHermesSetup({
        mode: secondMode,
        targetDir: tmpDir,
        endpoint: fakeApi.url,
        apiKey: 'test-key',
        projectName: 'host-smoke',
        quiet: true,
      });
      configureHermesMcpServerForLocalSource(tmpDir, fakeApi);

      const turn = await inspectHermesOfflineTurn(tmpDir);
      expect(turn.duplicateToolNames).toEqual({});
    },
    60_000,
  );

  it('reproduces and cleans the pre-release duplicate AutoMem tool state', async () => {
    await applyHermesSetup({
      mode: 'both',
      targetDir: tmpDir,
      endpoint: fakeApi.url,
      apiKey: 'test-key',
      projectName: 'host-smoke',
      quiet: true,
    });
    addPreReleaseMemoryMcpServer(tmpDir);
    setHermesEnv(tmpDir, 'AUTOMEM_HERMES_PROVIDER_TOOLS', 'true');
    configureHermesMcpServerForLocalSource(tmpDir, fakeApi);

    const before = await inspectHermesOfflineTurn(tmpDir);
    expect(before.duplicateToolNames).toMatchObject({
      mcp_automem_recall_memory: 2,
      mcp_automem_store_memory: 2,
    });

    await runUninstall({
      platform: 'hermes',
      projectDir: tmpDir,
      yes: true,
      quiet: true,
    });

    const parsed = parseYaml(fs.readFileSync(path.join(tmpDir, 'config.yaml'), 'utf8')) as {
      memory?: { provider?: string };
      mcp_servers?: Record<string, unknown>;
    };
    expect(parsed.memory?.provider).not.toBe('automem');
    expect(parsed.mcp_servers?.automem).toBeUndefined();
    expect(parsed.mcp_servers?.memory).toBeUndefined();
    expect(fs.existsSync(path.join(tmpDir, 'plugins', 'automem'))).toBe(false);

    const after = await inspectHermesOfflineTurn(tmpDir);
    expect(after.duplicateToolNames).toEqual({});
  }, 90_000);
});

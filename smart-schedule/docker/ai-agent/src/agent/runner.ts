import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  type SpawnConfig,
  type SpawnResult,
  type ClaudeMessage,
} from '../claude/spawner.js';

/**
 * Agent runtime abstraction.
 *
 * Route handlers depend on this interface, not on provider details.
 */
export interface AgentRunner {
  run(config: SpawnConfig): Promise<SpawnResult>;
  runStreaming(config: SpawnConfig): AsyncGenerator<ClaudeMessage>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveMcpLaunch(): { command: string; args: string[] } {
  const distMcpPath = path.resolve(__dirname, '../mcp/server.js');
  if (existsSync(distMcpPath)) {
    return { command: process.execPath, args: [distMcpPath] };
  }

  const srcMcpPath = path.resolve(__dirname, '../mcp/server.ts');
  const localTsx = path.resolve(process.cwd(), 'node_modules/.bin/tsx');
  if (existsSync(srcMcpPath) && existsSync(localTsx)) {
    return { command: localTsx, args: [srcMcpPath] };
  }

  return { command: process.execPath, args: [distMcpPath] };
}

function buildSdkEnv(config: SpawnConfig): Record<string, string> {
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter(([, v]) => typeof v === 'string')),
    CLAUDE_AGENT_SDK_CLIENT_APP: 'process-planning-ai-agent/1.0.0',
  };

  // Support either API key or long-lived auth token from site settings.
  if (config.keyType === 'claude_auth_token') {
    env.ANTHROPIC_AUTH_TOKEN = config.apiKey;
    delete env.ANTHROPIC_API_KEY;
  } else {
    env.ANTHROPIC_API_KEY = config.apiKey;
    delete env.ANTHROPIC_AUTH_TOKEN;
  }

  return env;
}

function extractTextFromAssistant(msg: SDKMessage): string {
  if (msg.type !== 'assistant') return '';
  const blocks = msg.message?.content;
  if (!Array.isArray(blocks)) return '';

  return blocks
    .filter((b) => b?.type === 'text' && typeof (b as { text?: unknown }).text === 'string')
    .map((b) => (b as { text: string }).text)
    .join('');
}

function mapStreamEventToText(msg: SDKMessage): string {
  if (msg.type !== 'stream_event') return '';
  const event = msg.event;

  if (
    event.type === 'content_block_delta' &&
    event.delta?.type === 'text_delta' &&
    typeof event.delta.text === 'string'
  ) {
    return event.delta.text;
  }

  return '';
}

function mapToolProgress(msg: SDKMessage): ClaudeMessage | null {
  if (msg.type === 'tool_progress') {
    return {
      type: 'tool_use',
      content: `Using tool: ${msg.tool_name}`,
      metadata: { toolName: msg.tool_name, toolUseId: msg.tool_use_id },
    };
  }

  if (msg.type === 'tool_use_summary') {
    return {
      type: 'tool_use',
      content: msg.summary,
      metadata: { precedingToolUseIds: msg.preceding_tool_use_ids },
    };
  }

  return null;
}

function mapResultErrors(msg: SDKMessage): string | null {
  if (msg.type !== 'result') return null;
  if (!msg.is_error) return null;
  if ('errors' in msg && Array.isArray(msg.errors) && msg.errors.length > 0) {
    return msg.errors.join(' | ');
  }
  return msg.subtype;
}

function createQuery(config: SpawnConfig) {
  const mcpLaunch = resolveMcpLaunch();

  return query({
    prompt: config.prompt,
    options: {
      cwd: process.cwd(),
      systemPrompt: config.systemPrompt,
      model: 'claude-sonnet-4-5',
      maxTurns: config.maxTurns ?? 15,
      includePartialMessages: true,
      thinking: { type: 'enabled', budgetTokens: 4096 },
      tools: [],
      permissionMode: 'dontAsk',
      env: buildSdkEnv(config),
      mcpServers: {
        'schedule-db': {
          type: 'stdio',
          command: mcpLaunch.command,
          args: mcpLaunch.args,
          env: {
            SUPABASE_URL: config.supabaseUrl,
            SUPABASE_SERVICE_KEY: config.supabaseServiceKey,
            MCP_SITE_ID: config.siteId,
          },
        },
      },
    },
  });
}

class SdkRunner implements AgentRunner {
  async run(config: SpawnConfig): Promise<SpawnResult> {
    const messages: ClaudeMessage[] = [];
    let sessionId = '';

    try {
      const q = createQuery(config);

      if (config.signal) {
        config.signal.addEventListener('abort', () => q.close(), { once: true });
      }

      for await (const msg of q) {
        sessionId = msg.session_id || sessionId;

        const toolProgress = mapToolProgress(msg);
        if (toolProgress) {
          messages.push(toolProgress);
        }

        const delta = mapStreamEventToText(msg);
        if (delta) {
          messages.push({ type: 'text', content: delta, metadata: { sessionId } });
        }

        if (msg.type === 'assistant') {
          const text = extractTextFromAssistant(msg);
          if (text) {
            messages.push({ type: 'text', content: text, metadata: { sessionId } });
          }
        }

        const resultErr = mapResultErrors(msg);
        if (resultErr) {
          messages.push({ type: 'error', content: resultErr, metadata: { sessionId } });
        }
      }

      return { sessionId, messages, isComplete: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      messages.push({ type: 'error', content: message });
      return { sessionId, messages, isComplete: false };
    }
  }

  async *runStreaming(config: SpawnConfig): AsyncGenerator<ClaudeMessage> {
    const q = createQuery(config);

    if (config.signal) {
      config.signal.addEventListener('abort', () => q.close(), { once: true });
    }

    try {
      for await (const msg of q) {
        const sessionId = msg.session_id || undefined;

        const toolProgress = mapToolProgress(msg);
        if (toolProgress) {
          yield {
            ...toolProgress,
            metadata: { ...(toolProgress.metadata ?? {}), ...(sessionId ? { sessionId } : {}) },
          };
        }

        const delta = mapStreamEventToText(msg);
        if (delta) {
          yield { type: 'text', content: delta, metadata: sessionId ? { sessionId } : undefined };
        }

        if (msg.type === 'assistant') {
          const text = extractTextFromAssistant(msg);
          if (text) {
            yield { type: 'text', content: text, metadata: sessionId ? { sessionId } : undefined };
          }
        }

        const resultErr = mapResultErrors(msg);
        if (resultErr) {
          yield { type: 'error', content: resultErr, metadata: sessionId ? { sessionId } : undefined };
        }
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      yield { type: 'error', content: err instanceof Error ? err.message : String(err) };
    }
  }
}

const runner: AgentRunner = new SdkRunner();

export function getAgentRunner(): AgentRunner {
  return runner;
}

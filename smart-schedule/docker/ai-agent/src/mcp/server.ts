#!/usr/bin/env node
/**
 * MCP server for the Process Planning Agent.
 *
 * Exposes schedule-db and scoring tools.
 * Runs as a child process spawned by Claude Code via stdio transport.
 *
 * Security:
 * - Tool allowlist: only registered schedule-db tools are exposed
 * - Explicit deny: shell, file, and web tools are never registered
 * - Site-scoped: all DB queries are filtered by MCP_SITE_ID
 * - DB credentials: received via own env, never passed to Claude parent
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { scheduleDbTools, handleScheduleDbTool } from './tools/schedule-db.js';
import { scoringTools, handleScoringTool } from './tools/scoring.js';
import { wikiTools, handleWikiTool } from './tools/wiki-search.js';

// ─── Environment ────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    process.stderr.write(`[mcp-server] ${name} is required\n`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_SERVICE_KEY = requireEnv('SUPABASE_SERVICE_KEY');
const MCP_SITE_ID = requireEnv('MCP_SITE_ID');

// ─── Supabase Client (service role — DB creds live here only) ───────────────

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Tool Allowlist ─────────────────────────────────────────────────────────

/** All allowed tool names. Anything not in this set is denied. */
const ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  ...scheduleDbTools.map((t) => t.name),
  ...scoringTools.map((t) => t.name),
  ...wikiTools.map((t) => t.name),
]);

/** Tool categories that are explicitly denied (for logging). */
const DENIED_CATEGORIES = ['shell', 'file', 'web', 'bash', 'read', 'write', 'edit'] as const;

/**
 * Check if a tool name is allowed.
 */
function isToolAllowed(toolName: string): boolean {
  return ALLOWED_TOOLS.has(toolName);
}

// ─── Combined Tool List ─────────────────────────────────────────────────────

const allTools = [...scheduleDbTools, ...scoringTools, ...wikiTools];

// ─── JSONRPC over stdio ─────────────────────────────────────────────────────

/**
 * Minimal MCP protocol implementation over stdio.
 *
 * Handles the standard MCP JSONRPC messages:
 * - initialize: server capabilities and info
 * - tools/list: return registered tools
 * - tools/call: execute a tool
 */

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

function sendResponse(response: JsonRpcResponse): void {
  const json = JSON.stringify(response);
  const msg = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
  process.stdout.write(msg);
}

function sendNotification(notification: JsonRpcNotification): void {
  const json = JSON.stringify(notification);
  const msg = `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`;
  process.stdout.write(msg);
}

async function handleRequest(request: JsonRpcRequest): Promise<void> {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize': {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: 'schedule-db',
            version: '1.0.0',
          },
        },
      });
      // Send initialized notification
      sendNotification({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      });
      break;
    }

    case 'tools/list': {
      sendResponse({
        jsonrpc: '2.0',
        id,
        result: {
          tools: allTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        },
      });
      break;
    }

    case 'tools/call': {
      const toolName = params?.name as string;
      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;

      // Tool allowlist enforcement
      if (!isToolAllowed(toolName)) {
        const isDeniedCategory = DENIED_CATEGORIES.some((cat) =>
          toolName.toLowerCase().includes(cat),
        );
        const reason = isDeniedCategory
          ? `Tool "${toolName}" is in a denied category (shell/file/web).`
          : `Tool "${toolName}" is not in the allowlist.`;

        process.stderr.write(`[mcp-server] DENIED tool call: ${toolName} — ${reason}\n`);

        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `DENIED: ${reason} Only schedule-db and scoring tools are permitted.` }],
            isError: true,
          },
        });
        break;
      }

      try {
        // Route to appropriate handler based on tool name
        const scoringToolNames = new Set(scoringTools.map((t) => t.name));
        const wikiToolNames = new Set(wikiTools.map((t) => t.name));
        const result = scoringToolNames.has(toolName)
          ? await handleScoringTool(toolName, toolArgs, supabase, MCP_SITE_ID)
          : wikiToolNames.has(toolName)
            ? await handleWikiTool(toolName, toolArgs, supabase, MCP_SITE_ID)
            : await handleScheduleDbTool(toolName, toolArgs, supabase, MCP_SITE_ID);

        sendResponse({ jsonrpc: '2.0', id, result });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        process.stderr.write(`[mcp-server] Tool error (${toolName}): ${message}\n`);
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Tool error: ${message}` }],
            isError: true,
          },
        });
      }
      break;
    }

    case 'ping': {
      sendResponse({ jsonrpc: '2.0', id, result: {} });
      break;
    }

    default: {
      // Ignore notifications (no id) and unknown methods
      if (id !== undefined) {
        sendResponse({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
      }
      break;
    }
  }
}

// ─── Message Parsing (Content-Length framing) ───────────────────────────────

let inputBuffer = '';

function processBuffer(): void {
  while (true) {
    // Look for Content-Length header
    const headerEnd = inputBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) break;

    const header = inputBuffer.slice(0, headerEnd);
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      // Skip malformed header
      inputBuffer = inputBuffer.slice(headerEnd + 4);
      continue;
    }

    const contentLength = parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;

    if (inputBuffer.length < bodyStart + contentLength) {
      // Not enough data yet
      break;
    }

    const body = inputBuffer.slice(bodyStart, bodyStart + contentLength);
    inputBuffer = inputBuffer.slice(bodyStart + contentLength);

    try {
      const request = JSON.parse(body) as JsonRpcRequest;
      void handleRequest(request);
    } catch (err) {
      process.stderr.write(
        `[mcp-server] Failed to parse JSONRPC message: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

// ─── Start ──────────────────────────────────────────────────────────────────

process.stderr.write(`[mcp-server] Starting schedule-db MCP server for site ${MCP_SITE_ID}\n`);
process.stderr.write(`[mcp-server] Registered ${allTools.length} tools: ${allTools.map((t) => t.name).join(', ')}\n`);
process.stderr.write(`[mcp-server] Denied categories: ${DENIED_CATEGORIES.join(', ')}\n`);

process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk: string) => {
  inputBuffer += chunk;
  processBuffer();
});

process.stdin.on('end', () => {
  process.stderr.write('[mcp-server] stdin closed, shutting down\n');
  process.exit(0);
});

process.on('SIGTERM', () => {
  process.stderr.write('[mcp-server] SIGTERM received, shutting down\n');
  process.exit(0);
});

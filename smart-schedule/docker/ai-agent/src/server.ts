import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';
import type { Request, Response, NextFunction } from 'express';
import type { JwtUserClaims } from './security/permissions.js';
import { chatRouter } from './routes/chat.js';
import { scanRouter } from './routes/scan.js';
import { sessionsRouter } from './routes/sessions.js';
import { draftsRouter } from './routes/drafts.js';
import { adminRouter } from './routes/admin.js';
import { SchedulerRunner, type TaskExecutionContext, type TaskExecutionResult } from './scheduler/runner.js';
import { runClaudeScan } from './claude/scan-runner.js';

// ─── Environment ──────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? '3100', 10);
const JWT_SECRET = process.env.JWT_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://postgrest:3000';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const AI_ENCRYPTION_KEY_CURRENT = process.env.AI_ENCRYPTION_KEY_CURRENT;
const AI_ENCRYPTION_KEY_PREVIOUS = process.env.AI_ENCRYPTION_KEY_PREVIOUS;

if (!JWT_SECRET) throw new Error('JWT_SECRET is required');
if (!SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY is required');
if (!AI_ENCRYPTION_KEY_CURRENT) throw new Error('AI_ENCRYPTION_KEY_CURRENT is required');

// ─── Structured Logger ──────────────────────────────────────────────────────

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  correlationId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  userId?: string;
  [key: string]: unknown;
}

function log(entry: LogEntry): void {
  process.stdout.write(JSON.stringify(entry) + '\n');
}

// ─── Supabase admin client (service role) ─────────────────────────────────────

export const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
// createClient constructs the REST URL as `${url}/rest/v1`, but PostgREST is
// accessed directly (no prefix) inside Docker.  Override the internal URL.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(supabaseAdmin as any).rest.url = SUPABASE_URL;

// ─── Encryption config (available to routes) ─────────────────────────────────

export const encryptionConfig = {
  currentKey: AI_ENCRYPTION_KEY_CURRENT,
  previousKey: AI_ENCRYPTION_KEY_PREVIOUS ?? null,
};

export const runtimeConfig = {
  supabaseUrl: SUPABASE_URL,
  supabaseServiceKey: SUPABASE_SERVICE_KEY,
};

// ─── Augment Express Request ─────────────────────────────────────────────────

declare global {
  namespace Express {
    interface Request {
      user?: JwtUserClaims;
      correlationId?: string;
    }
  }
}

// ─── Rate Limiter (in-memory sliding window) ────────────────────────────────

interface RateLimitBucket {
  tokens: number;
  lastRefill: number;
}

const RATE_LIMIT_MAX = 60;          // max requests per window
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const rateLimitStore = new Map<string, RateLimitBucket>();

// Clean up stale entries every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  for (const [key, bucket] of rateLimitStore) {
    if (bucket.lastRefill < cutoff) rateLimitStore.delete(key);
  }
}, 300_000).unref();

function getRateLimitKey(req: Request): string {
  // Rate limit by user ID from JWT, fall back to IP
  return req.user?.sub ?? req.ip ?? 'unknown';
}

function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
  const key = getRateLimitKey(req);
  const now = Date.now();

  let bucket = rateLimitStore.get(key);
  if (!bucket) {
    bucket = { tokens: RATE_LIMIT_MAX, lastRefill: now };
    rateLimitStore.set(key, bucket);
  }

  // Refill tokens based on elapsed time
  const elapsed = now - bucket.lastRefill;
  const refill = Math.floor((elapsed / RATE_LIMIT_WINDOW_MS) * RATE_LIMIT_MAX);
  if (refill > 0) {
    bucket.tokens = Math.min(RATE_LIMIT_MAX, bucket.tokens + refill);
    bucket.lastRefill = now;
  }

  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, bucket.tokens - 1));

  if (bucket.tokens <= 0) {
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW_MS - elapsed) / 1000);
    res.setHeader('Retry-After', retryAfter);
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'Rate limit exceeded',
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      userId: key,
    });
    res.status(429).json({ error: 'Too many requests. Please retry later.' });
    return;
  }

  bucket.tokens--;
  next();
}

// ─── Request Timeout ────────────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = parseInt(process.env.REQUEST_TIMEOUT_MS ?? '30000', 10);

function timeoutMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Skip timeout for SSE streaming endpoints and long-running scans
  if (req.path === '/ai/chat' || req.path === '/ai/scan') {
    next();
    return;
  }

  const timer = setTimeout(() => {
    if (!res.headersSent) {
      log({
        timestamp: new Date().toISOString(),
        level: 'warn',
        message: 'Request timeout',
        correlationId: req.correlationId,
        method: req.method,
        path: req.path,
        durationMs: REQUEST_TIMEOUT_MS,
      });
      res.status(504).json({ error: 'Request timeout' });
    }
  }, REQUEST_TIMEOUT_MS);

  res.on('close', () => clearTimeout(timer));
  res.on('finish', () => clearTimeout(timer));
  next();
}

// ─── Correlation ID Middleware ───────────────────────────────────────────────

function correlationIdMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string) ?? randomUUID();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);
  next();
}

// ─── Request Logging Middleware ─────────────────────────────────────────────

function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now();

  res.on('finish', () => {
    log({
      timestamp: new Date().toISOString(),
      level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      message: 'HTTP request',
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
      userId: req.user?.sub,
    });
  });

  next();
}

// ─── JWT Auth Middleware ─────────────────────────────────────────────────────

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET!) as JwtUserClaims;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = express();

// Global middleware (order matters)
app.use(correlationIdMiddleware);
app.use(requestLoggingMiddleware);
app.use(express.json({ limit: '1mb' }));

// Health endpoint (unauthenticated, no rate limit, no timeout)
app.get('/ai/health', async (_req: Request, res: Response) => {
  const checks: Record<string, string> = {
    service: 'ok',
    encryption: AI_ENCRYPTION_KEY_CURRENT ? 'ok' : 'missing',
    scheduler: scheduler?.isRunning() ? 'ok' : SCHEDULER_ENABLED ? 'stopped' : 'disabled',
  };

  // Check DB connectivity
  try {
    const { error } = await supabaseAdmin.from('ai_config').select('id').limit(1);
    checks.database = error ? 'error' : 'ok';
  } catch {
    checks.database = 'unreachable';
  }

  // Validate stored AI credentials are decryptable
  try {
    const { data: configs } = await supabaseAdmin
      .from('ai_config')
      .select('credential_encrypted')
      .not('credential_encrypted', 'is', null)
      .limit(1);

    if (configs && configs.length > 0 && configs[0].credential_encrypted) {
      // Attempt to import and decrypt to verify the key is valid
      const { decrypt } = await import('./security/crypto.js');
      try {
        decrypt(configs[0].credential_encrypted, AI_ENCRYPTION_KEY_CURRENT);
        checks.credentials = 'ok';
      } catch {
        // Try previous key if available
        if (AI_ENCRYPTION_KEY_PREVIOUS) {
          try {
            decrypt(configs[0].credential_encrypted, AI_ENCRYPTION_KEY_PREVIOUS);
            checks.credentials = 'rotation_needed';
          } catch {
            checks.credentials = 'invalid';
          }
        } else {
          checks.credentials = 'invalid';
        }
      }
    } else {
      checks.credentials = 'not_configured';
    }
  } catch {
    checks.credentials = 'check_failed';
  }

  // Verify SDK package is importable and MCP server is bootable/listing tools
  try {
    await import('@anthropic-ai/claude-agent-sdk');
    checks.sdk = 'ok';
  } catch {
    checks.sdk = 'missing';
  }

  checks.mcp = await checkMcpServerReadiness();

  const degraded = Object.values(checks).some(
    (v) => v !== 'ok' && v !== 'disabled' && v !== 'not_configured'
  );
  const hasError = Object.values(checks).some(
    (v) => v === 'error' || v === 'unreachable' || v === 'missing'
  );

  const status = hasError ? 'unhealthy' : degraded ? 'degraded' : 'healthy';
  res.status(status === 'healthy' ? 200 : 503).json({
    status,
    checks,
    timestamp: new Date().toISOString(),
  });
});

async function checkMcpServerReadiness(): Promise<string> {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distPath = path.resolve(__dirname, './mcp/server.js');
  const srcPath = path.resolve(__dirname, './mcp/server.ts');
  const tsxPath = path.resolve(process.cwd(), 'node_modules/.bin/tsx');

  let command = process.execPath;
  let args: string[] = [distPath];

  if (!existsSync(distPath)) {
    if (existsSync(srcPath) && existsSync(tsxPath)) {
      command = tsxPath;
      args = [srcPath];
    } else {
      return 'missing_script';
    }
  }

  const child = spawn(command, args, {
    env: {
      ...process.env,
      SUPABASE_URL,
      SUPABASE_SERVICE_KEY,
      MCP_SITE_ID: '00000000-0000-0000-0000-000000000000',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  let stderrBuffer = '';
  let finished = false;

  const timeout = setTimeout(() => {
    if (!finished) child.kill('SIGKILL');
  }, 5000);

  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf-8');
  });

  function writeRpc(payload: object): void {
    const json = JSON.stringify(payload);
    child.stdin.write(`Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`);
  }

  return await new Promise<string>((resolve) => {
    function done(status: string): void {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      child.kill('SIGTERM');
      resolve(status);
    }

    child.on('error', () => done('spawn_failed'));
    child.on('exit', (code) => {
      if (finished) return;
      done(code === 0 ? 'ok' : 'boot_failed');
    });

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString('utf-8');

      // Minimal readiness check: if MCP tools/list response returns scoring/schedule tools, it's ready.
      if (
        stdoutBuffer.includes('"method":"notifications/initialized"') ||
        stdoutBuffer.includes('"tools"')
      ) {
        if (
          stdoutBuffer.includes('"score_health"') &&
          stdoutBuffer.includes('"query_batches"')
        ) {
          done('ok');
          return;
        }
      }
    });

    writeRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    writeRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });

    setTimeout(() => {
      if (!finished) {
        if (stderrBuffer.includes('is required')) done('env_error');
        else done('timeout');
      }
    }, 1200);
  });
}

// Protected routes — rate limit and timeout applied after auth
app.use('/ai', authMiddleware);
app.use('/ai', rateLimitMiddleware);
app.use('/ai', timeoutMiddleware);
app.use('/ai', chatRouter);
app.use('/ai', scanRouter);
app.use('/ai', sessionsRouter);
app.use('/ai', draftsRouter);
app.use('/ai', adminRouter);

// Global error handler
app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
  log({
    timestamp: new Date().toISOString(),
    level: 'error',
    message: `Unhandled error: ${err.message}`,
    correlationId: req.correlationId,
    method: req.method,
    path: req.path,
  });
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Scheduler ──────────────────────────────────────────────────────────────

const SCHEDULER_ENABLED = process.env.SCHEDULER_ENABLED !== 'false';
const SCHEDULER_POLL_INTERVAL = parseInt(process.env.SCHEDULER_POLL_INTERVAL_MS ?? '30000', 10);

/**
 * Default task executor: creates an AI scan for the scheduled task.
 * In production, this triggers the Claude agent via the spawner.
 */
async function defaultTaskExecutor(ctx: TaskExecutionContext): Promise<TaskExecutionResult> {
  const recipientIds = (ctx.notifyUserIds && ctx.notifyUserIds.length > 0)
    ? ctx.notifyUserIds
    : ctx.createdBy
      ? [ctx.createdBy]
      : [];

  const result = await runClaudeScan({
    supabase: supabaseAdmin,
    supabaseUrl: runtimeConfig.supabaseUrl,
    supabaseServiceKey: runtimeConfig.supabaseServiceKey,
    siteId: ctx.siteId,
    scanType: ctx.taskType as 'schedule_optimization' | 'rule_analysis' | 'capacity_check' | 'full_audit',
    promptOverride: ctx.customPrompt,
    triggeredBy: null,
    scheduledTaskId: ctx.taskId,
    currentKey: encryptionConfig.currentKey,
    previousKey: encryptionConfig.previousKey,
  });

  if (!result.success) {
    await createTaskNotifications({
      siteId: ctx.siteId,
      userIds: recipientIds,
      title: `Scheduled task failed: ${ctx.taskName}`,
      message: result.error ?? 'Scheduled scan failed',
      type: 'error',
    });
    return {
      success: false,
      error: result.error ?? 'Scheduled scan failed',
      credentialError: result.credentialError,
    };
  }

  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    message: `Completed scheduled scan ${result.scanId ?? 'unknown'} for task ${ctx.taskId}`,
  });

  await createTaskNotifications({
    siteId: ctx.siteId,
    userIds: recipientIds,
    title: `Scheduled task completed: ${ctx.taskName}`,
    message: `Scan ${result.scanId ?? 'unknown'} completed successfully.`,
    type: 'info',
  });

  return { success: true };
}

async function createTaskNotifications(input: {
  siteId: string;
  userIds: string[];
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error';
}): Promise<void> {
  if (!input.userIds.length) return;

  const rows = input.userIds.map((userId) => ({
    site_id: input.siteId,
    user_id: userId,
    title: input.title,
    message: input.message,
    type: input.type,
  }));

  const { error } = await supabaseAdmin.from('notifications').insert(rows);
  if (error) {
    log({
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: `Failed to create scheduled-task notifications: ${error.message}`,
      siteId: input.siteId,
    });
  }
}

let scheduler: SchedulerRunner | null = null;

if (SCHEDULER_ENABLED) {
  scheduler = new SchedulerRunner({
    supabase: supabaseAdmin,
    pollIntervalMs: SCHEDULER_POLL_INTERVAL,
    executeTask: defaultTaskExecutor,
    encryptionKey: AI_ENCRYPTION_KEY_CURRENT,
    previousEncryptionKey: AI_ENCRYPTION_KEY_PREVIOUS,
  });
}

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    message: `AI agent listening on port ${PORT}`,
  });

  if (scheduler) {
    scheduler.start();
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Scheduler engine started',
    });
  } else {
    log({
      timestamp: new Date().toISOString(),
      level: 'info',
      message: 'Scheduler disabled (SCHEDULER_ENABLED=false)',
    });
  }
});

// Graceful shutdown
function shutdown(): void {
  log({
    timestamp: new Date().toISOString(),
    level: 'info',
    message: 'Shutting down...',
  });
  if (scheduler) {
    scheduler.stop();
  }
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { scheduler };
export default app;

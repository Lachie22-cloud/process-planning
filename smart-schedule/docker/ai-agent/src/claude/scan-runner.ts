import type { SupabaseClient } from '@supabase/supabase-js';
import { decrypt } from '../security/crypto.js';
import { getAgentRunner } from '../agent/runner.js';
import type { ClaudeMessage } from './spawner.js';
import { assembleSystemPrompt } from './prompt-assembler.js';

export interface ResolveCredentialOptions {
  supabase: SupabaseClient;
  siteId: string;
  currentKey: string;
  previousKey?: string | null;
}

export interface ResolvedCredential {
  keyType: 'anthropic_api_key' | 'claude_auth_token';
  credential: string;
}

interface AiConfigRow {
  key_type: 'anthropic_api_key' | 'claude_auth_token';
  credential_encrypted: string;
  credential_status: 'valid' | 'invalid' | 'expired' | 'unknown';
  credential_expires_at: string | null;
  enabled: boolean;
}

export async function resolveSiteCredential(opts: ResolveCredentialOptions): Promise<ResolvedCredential> {
  const { data, error } = await opts.supabase
    .from('ai_config')
    .select('key_type, credential_encrypted, credential_status, credential_expires_at, enabled')
    .eq('site_id', opts.siteId)
    .single<AiConfigRow>();

  if (error || !data) {
    throw new Error('AI configuration not found for this site');
  }

  if (!data.enabled) {
    throw new Error('AI configuration is disabled for this site');
  }

  if (data.credential_status === 'invalid' || data.credential_status === 'expired') {
    throw new Error(`Credential status is ${data.credential_status}`);
  }

  if (data.credential_expires_at && new Date(data.credential_expires_at) <= new Date()) {
    await opts.supabase
      .from('ai_config')
      .update({ credential_status: 'expired', updated_at: new Date().toISOString() })
      .eq('site_id', opts.siteId);
    throw new Error('Credential is expired');
  }

  try {
    return {
      keyType: data.key_type,
      credential: decrypt(data.credential_encrypted, opts.currentKey),
    };
  } catch {
    if (opts.previousKey) {
      try {
        return {
          keyType: data.key_type,
          credential: decrypt(data.credential_encrypted, opts.previousKey),
        };
      } catch {
        // fall through to final error
      }
    }
    throw new Error('Credential decrypt failed');
  }
}

export interface RunClaudeScanOptions {
  supabase: SupabaseClient;
  supabaseUrl: string;
  supabaseServiceKey: string;
  siteId: string;
  scanType: string;
  promptOverride?: string | null;
  triggeredBy?: string | null;
  scheduledTaskId?: string | null;
  currentKey: string;
  previousKey?: string | null;
  /** If provided, reuse this existing scan row instead of creating a new one. */
  existingScanId?: string | null;
  /** Custom AI objective from ai_scan_types table. */
  aiObjective?: string;
}

export interface RunClaudeScanResult {
  success: boolean;
  scanId?: string;
  error?: string;
  credentialError?: boolean;
}

interface ScanContext {
  resources?: Array<Record<string, unknown>>;
  batchSummary?: Record<string, unknown>;
  weekStart?: string;
  weekEnd?: string;
}

function buildScanPrompt(
  scanType: string,
  promptOverride?: string | null,
  aiObjective?: string,
  context?: ScanContext,
): string {
  if (promptOverride && promptOverride.trim()) {
    return promptOverride.trim();
  }

  const objective = aiObjective ?? 'Perform an AI analysis scan and return concise findings.';

  const lines: string[] = [
    `Run scan type: ${scanType}`,
    objective,
    '',
  ];

  // Inject a compact resource list so the AI uses real names
  if (context?.resources && context.resources.length > 0) {
    const compact = context.resources.map((r) => `${r.display_name ?? r.resource_code} (${r.id})`);
    lines.push(`Site resources: ${compact.join(', ')}`);
  }

  if (context?.batchSummary && context.weekStart && context.weekEnd) {
    lines.push(`Period ${context.weekStart} to ${context.weekEnd}: ${JSON.stringify(context.batchSummary)}`);
  }

  lines.push('');
  lines.push(
    'Use real resource names above. Do NOT invent names like "M-001". ' +
    'Call score_health first, then write your final report in these sections:',
  );
  lines.push('### Critical Issues');
  lines.push('### Warnings');
  lines.push('### Opportunities');
  lines.push('### Summary');
  lines.push('Be concise. Name specific resources, batches, and dates. Skip progress updates.');

  return lines.join('\n');
}

function normalizeMessages(messages: ClaudeMessage[]): Array<Record<string, unknown>> {
  return messages.slice(0, 200).map((m) => ({
    type: m.type,
    content: m.content,
    metadata: m.metadata ?? null,
  }));
}

export async function runClaudeScan(opts: RunClaudeScanOptions): Promise<RunClaudeScanResult> {
  const nowIso = new Date().toISOString();
  let scanId: string;

  if (opts.existingScanId) {
    // Reuse existing scan row (created by the async endpoint) — mark as running
    scanId = opts.existingScanId;
    await opts.supabase
      .from('ai_scans')
      .update({ status: 'running', started_at: nowIso })
      .eq('id', scanId);
  } else {
    // Create a new scan row (used by scheduled tasks / direct callers)
    const { data: createdScan, error: createErr } = await opts.supabase
      .from('ai_scans')
      .insert({
        site_id: opts.siteId,
        scan_type: opts.scanType,
        status: 'running',
        triggered_by: opts.triggeredBy ?? null,
        scheduled_task_id: opts.scheduledTaskId ?? null,
        report: {},
        started_at: nowIso,
      })
      .select('id')
      .single<{ id: string }>();

    if (createErr || !createdScan) {
      return { success: false, error: `Failed to create scan: ${createErr?.message ?? 'unknown'}` };
    }
    scanId = createdScan.id;
  }

  try {
    const cred = await resolveSiteCredential({
      supabase: opts.supabase,
      siteId: opts.siteId,
      currentKey: opts.currentKey,
      previousKey: opts.previousKey,
    });

    // Look up site name for prompt context
    const { data: siteRow } = await opts.supabase
      .from('sites')
      .select('name')
      .eq('id', opts.siteId)
      .single();
    const siteName = siteRow?.name ?? undefined;

    // Pre-fetch real site data so the AI starts with actual context
    const now = new Date();
    const weekStart = now.toISOString().split('T')[0];
    const weekEnd = new Date(now.getTime() + 7 * 86_400_000).toISOString().split('T')[0];

    const [resourceResult, batchResult] = await Promise.all([
      opts.supabase
        .from('resources')
        .select('id, resource_code, display_name')
        .eq('site_id', opts.siteId)
        .eq('active', true)
        .order('sort_order', { ascending: true }),
      opts.supabase
        .from('batches')
        .select('plan_resource_id, status')
        .eq('site_id', opts.siteId)
        .gte('plan_date', weekStart)
        .lte('plan_date', weekEnd)
        .limit(200),
    ]);

    // Build a per-resource batch count summary
    const resources = (resourceResult.data ?? []) as Array<Record<string, unknown>>;
    const batches = (batchResult.data ?? []) as Array<Record<string, unknown>>;

    const resourceNameMap: Record<string, string> = {};
    for (const r of resources) {
      resourceNameMap[r.id as string] = (r.display_name ?? r.resource_code) as string;
    }

    const countByResource: Record<string, number> = {};
    const countByStatus: Record<string, number> = {};
    for (const b of batches) {
      const rid = b.plan_resource_id as string;
      const rName = resourceNameMap[rid] ?? rid;
      countByResource[rName] = (countByResource[rName] ?? 0) + 1;
      const status = b.status as string;
      countByStatus[status] = (countByStatus[status] ?? 0) + 1;
    }

    const scanContext: ScanContext = {
      resources,
      batchSummary: {
        total_batches: batches.length,
        batches_by_status: countByStatus,
        batches_by_resource: countByResource,
      },
      weekStart,
      weekEnd,
    };

    const runner = getAgentRunner();
    const spawnResult = await runner.run({
      apiKey: cred.credential,
      keyType: cred.keyType,
      supabaseUrl: opts.supabaseUrl,
      supabaseServiceKey: opts.supabaseServiceKey,
      siteId: opts.siteId,
      prompt: buildScanPrompt(opts.scanType, opts.promptOverride, opts.aiObjective, scanContext),
      systemPrompt: await assembleSystemPrompt({ supabase: opts.supabase, siteId: opts.siteId, siteName, context: 'scan' }),
      maxTurns: 8,
      supabase: opts.supabase,
      context: 'scan',
    });

    const report = {
      completed: spawnResult.isComplete,
      scan_type: opts.scanType,
      claude_session_id: spawnResult.sessionId || null,
      message_count: spawnResult.messages.length,
      messages: normalizeMessages(spawnResult.messages),
      generated_at: new Date().toISOString(),
    };

    const hasError = spawnResult.messages.some((m) => m.type === 'error');

    await opts.supabase
      .from('ai_scans')
      .update({
        status: hasError ? 'failed' : 'completed',
        report,
        error_message: hasError ? 'Claude execution returned an error message' : null,
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId);

    return {
      success: !hasError,
      scanId,
      error: hasError ? 'Claude execution returned an error message' : undefined,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    const credentialError = /credential|api key|auth token|decrypt|expired|disabled/i.test(errorMsg);

    await opts.supabase
      .from('ai_scans')
      .update({
        status: 'failed',
        error_message: errorMsg,
        completed_at: new Date().toISOString(),
      })
      .eq('id', scanId);

    return {
      success: false,
      scanId,
      error: errorMsg,
      credentialError,
    };
  }
}

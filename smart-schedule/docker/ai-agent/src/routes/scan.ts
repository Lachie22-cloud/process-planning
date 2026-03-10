import { Router } from 'express';
import type { Request, Response } from 'express';
import { authorise, type JwtUserClaims } from '../security/permissions.js';
import { supabaseAdmin, encryptionConfig, runtimeConfig } from '../server.js';
import { runClaudeScan } from '../claude/scan-runner.js';

export const scanRouter = Router();

/** Get site_users.id from JWT (set by custom_access_token_hook). */
function siteUserId(user: JwtUserClaims): string {
  return user.user_id ?? user.sub;
}

/**
 * POST /ai/scan
 * Triggers a manual AI scan and executes Claude headless analysis.
 * Requires: planning.ai permission.
 *
 * Body: { siteId, scanType }
 * Response: { scanId, status }
 */
scanRouter.post('/scan', async (req: Request, res: Response) => {
  const user = req.user!;
  const { siteId, scanType, promptOverride } = req.body as {
    siteId: string;
    scanType: 'schedule_optimization' | 'rule_analysis' | 'capacity_check' | 'full_audit';
    promptOverride?: string;
  };

  if (!siteId || !scanType) {
    res.status(400).json({ error: 'siteId and scanType are required' });
    return;
  }

  const validTypes = ['schedule_optimization', 'rule_analysis', 'capacity_check', 'full_audit'];
  if (!validTypes.includes(scanType)) {
    res.status(400).json({ error: `Invalid scanType. Must be one of: ${validTypes.join(', ')}` });
    return;
  }

  const auth = authorise(user, 'ai.scan', siteId);
  if (!auth.allowed) {
    res.status(403).json({ error: auth.reason });
    return;
  }

  // Create a pending scan row so we can return 202 immediately
  const nowIso = new Date().toISOString();
  const { data: pendingScan, error: createErr } = await supabaseAdmin
    .from('ai_scans')
    .insert({
      site_id: siteId,
      scan_type: scanType,
      status: 'pending',
      triggered_by: siteUserId(user),
      report: {},
      created_at: nowIso,
    })
    .select('id')
    .single<{ id: string }>();

  if (createErr || !pendingScan) {
    res.status(500).json({ error: `Failed to create scan: ${createErr?.message ?? 'unknown'}` });
    return;
  }

  // Return 202 immediately — the frontend polls via useAiScans
  res.status(202).json({
    scanId: pendingScan.id,
    status: 'pending',
    createdAt: nowIso,
  });

  // Fire scan asynchronously — updates the scan row on completion/failure
  runClaudeScan({
    supabase: supabaseAdmin,
    supabaseUrl: runtimeConfig.supabaseUrl,
    supabaseServiceKey: runtimeConfig.supabaseServiceKey,
    siteId,
    scanType,
    triggeredBy: siteUserId(user),
    currentKey: encryptionConfig.currentKey,
    previousKey: encryptionConfig.previousKey,
    existingScanId: pendingScan.id,
    promptOverride: promptOverride ?? null,
  }).catch((err) => {
    console.error(`[scan] Async scan ${pendingScan.id} failed:`, err);
    supabaseAdmin
      .from('ai_scans')
      .update({
        status: 'failed',
        error_message: err instanceof Error ? err.message : String(err),
        completed_at: new Date().toISOString(),
      })
      .eq('id', pendingScan.id)
      .then(() => {});
  });
});

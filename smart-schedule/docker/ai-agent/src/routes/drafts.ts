import { Router } from 'express';
import { z } from 'zod';
import type { Request, Response } from 'express';
import { authorise, type JwtUserClaims } from '../security/permissions.js';
import { supabaseAdmin } from '../server.js';

export const draftsRouter = Router();

/** Get site_users.id from JWT (set by custom_access_token_hook). */
function siteUserId(user: JwtUserClaims): string {
  return user.user_id ?? user.sub;
}

// ─── Payload validation schemas per draft_type ───────────────────────────────

const scheduleChangePayload = z.object({
  changes: z
    .array(
      z.object({
        batch_id: z.string().uuid(),
        plan_date: z.string().optional(),
        plan_resource_id: z.string().uuid().optional(),
        status: z.string().optional(),
      })
    )
    .min(1, 'changes array must not be empty'),
});

const ruleSuggestionPayload = z.object({
  rules: z
    .array(
      z.object({
        source_resource_id: z.string().uuid(),
        target_resource_id: z.string().uuid(),
        conditions: z.record(z.unknown()).optional(),
      })
    )
    .min(1, 'rules array must not be empty'),
});

const resourceRebalancePayload = z.object({
  assignments: z
    .array(
      z.object({
        batch_id: z.string().uuid(),
        new_resource_id: z.string().uuid(),
      })
    )
    .min(1, 'assignments array must not be empty'),
});

const payloadValidators: Record<string, z.ZodType> = {
  schedule_change: scheduleChangePayload,
  rule_suggestion: ruleSuggestionPayload,
  resource_rebalance: resourceRebalancePayload,
};

/**
 * POST /ai/drafts/:id/approve
 * Approves a pending AI draft.
 * Requires: planning.vet permission.
 */
draftsRouter.post('/drafts/:id/approve', async (req: Request, res: Response) => {
  await handleDraftAction(req, res, 'approve');
});

/**
 * POST /ai/drafts/:id/reject
 * Rejects a pending AI draft.
 * Requires: planning.vet permission.
 */
draftsRouter.post('/drafts/:id/reject', async (req: Request, res: Response) => {
  await handleDraftAction(req, res, 'reject');
});

/**
 * POST /ai/drafts/:id/apply
 * Applies an approved AI draft transactionally via Supabase RPC.
 * Requires: ai.drafts.apply permission.
 *
 * The RPC `apply_ai_draft` atomically:
 * 1. Locks the draft row FOR UPDATE
 * 2. Verifies status='approved'
 * 3. Validates payload structure against draft_type
 * 4. Applies domain mutations (batches, substitution_rules, resources)
 * 5. Marks draft as 'applied' with actor/timestamp
 * 6. Inserts audit log entry
 *
 * Returns 409 on stale status / concurrency conflict.
 * Returns 500 on transaction failure.
 */
draftsRouter.post('/drafts/:id/apply', async (req: Request, res: Response) => {
  const user = req.user!;
  const draftId = req.params.id;

  // Fetch draft to get site_id for auth check and payload for pre-validation
  const { data: draft, error: fetchErr } = await supabaseAdmin
    .from('ai_drafts')
    .select('id, site_id, status, draft_type, payload')
    .eq('id', draftId)
    .single();

  if (fetchErr || !draft) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }

  const auth = authorise(user, 'ai.drafts.apply', draft.site_id);
  if (!auth.allowed) {
    res.status(403).json({ error: auth.reason });
    return;
  }

  if (draft.status !== 'approved') {
    res.status(409).json({
      error: `Draft must be in 'approved' status to apply. Current status: ${draft.status}`,
    });
    return;
  }

  // Pre-validate payload on the TypeScript side (defense-in-depth; the RPC also validates)
  const validator = payloadValidators[draft.draft_type];
  if (!validator) {
    res.status(400).json({ error: `Unknown draft type: ${draft.draft_type}` });
    return;
  }

  const parsed = validator.safeParse(draft.payload);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Draft payload is invalid for its type',
      details: parsed.error.issues.map((i) => i.message),
    });
    return;
  }

  try {
    // Call the transactional RPC — this wraps lock + validate + domain-apply + status-update + audit
    const { data, error: rpcErr } = await supabaseAdmin.rpc('apply_ai_draft', {
      p_draft_id: draftId,
      p_user_id: siteUserId(user),
    });

    if (rpcErr) {
      const msg = rpcErr.message ?? '';

      // Map RPC exceptions to appropriate HTTP status codes
      if (msg.includes('DRAFT_NOT_FOUND')) {
        res.status(404).json({ error: 'Draft not found' });
        return;
      }
      if (msg.includes('DRAFT_STATUS_CONFLICT')) {
        res.status(409).json({
          error: 'Draft status has changed. It may have been modified by another user.',
          detail: msg,
        });
        return;
      }
      if (msg.includes('PAYLOAD_INVALID')) {
        res.status(400).json({
          error: 'Draft payload validation failed',
          detail: msg,
        });
        return;
      }
      if (msg.includes('DOMAIN_ERROR')) {
        res.status(422).json({
          error: 'Domain mutation failed — referenced entity not found in this site',
          detail: msg,
        });
        return;
      }

      // Unknown RPC error → 500
      console.error('[ai-agent] Draft apply RPC error:', rpcErr);
      res.status(500).json({ error: 'Internal error applying draft' });
      return;
    }

    res.json({
      id: draftId,
      status: 'applied',
      draftType: data?.draft_type ?? draft.draft_type,
      appliedAt: data?.applied_at ?? new Date().toISOString(),
    });
  } catch (err) {
    console.error('[ai-agent] Draft apply error:', err);
    res.status(500).json({ error: 'Internal error applying draft' });
  }
});

/**
 * Handles approve/reject actions for drafts.
 */
async function handleDraftAction(
  req: Request,
  res: Response,
  action: 'approve' | 'reject'
): Promise<void> {
  const user = req.user!;
  const draftId = req.params.id;
  const { comment } = req.body as { comment?: string };

  // Fetch draft to get site_id
  const { data: draft, error: fetchErr } = await supabaseAdmin
    .from('ai_drafts')
    .select('id, site_id, status')
    .eq('id', draftId)
    .single();

  if (fetchErr || !draft) {
    res.status(404).json({ error: 'Draft not found' });
    return;
  }

  const routeAction = action === 'approve' ? 'ai.drafts.approve' : 'ai.drafts.reject';
  const auth = authorise(user, routeAction, draft.site_id);
  if (!auth.allowed) {
    res.status(403).json({ error: auth.reason });
    return;
  }

  if (draft.status !== 'pending') {
    res.status(409).json({
      error: `Draft must be in 'pending' status to ${action}. Current status: ${draft.status}`,
    });
    return;
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  try {
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from('ai_drafts')
      .update({
        status: newStatus,
        reviewed_by: siteUserId(user),
        reviewed_at: new Date().toISOString(),
        review_comment: comment ?? null,
      })
      .eq('id', draftId)
      .eq('status', 'pending') // optimistic lock
      .select('id, status, reviewed_by, reviewed_at, review_comment')
      .single();

    if (updateErr || !updated) {
      res.status(409).json({
        error: `Failed to ${action} draft. It may have been modified by another user.`,
      });
      return;
    }

    res.json({
      id: updated.id,
      status: updated.status,
      reviewedBy: updated.reviewed_by,
      reviewedAt: updated.reviewed_at,
      reviewComment: updated.review_comment,
    });
  } catch (err) {
    console.error(`[ai-agent] Draft ${action} error:`, err);
    res.status(500).json({ error: `Internal error during draft ${action}` });
  }
}

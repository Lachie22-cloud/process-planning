import { Router } from 'express';
import type { Request, Response } from 'express';
import { authorise, type JwtUserClaims } from '../security/permissions.js';
import { supabaseAdmin } from '../server.js';

export const sessionsRouter = Router();

/** Get site_users.id from JWT (set by custom_access_token_hook). */
function siteUserId(user: JwtUserClaims): string {
  return user.user_id ?? user.sub;
}

/**
 * GET /ai/sessions
 * Lists chat sessions for the current user and site.
 * Requires: planning.ai permission.
 *
 * Query params: siteId (required), status? ('active' | 'archived'), limit?, offset?
 * Response: { sessions: [...], total: number }
 */
sessionsRouter.get('/sessions', async (req: Request, res: Response) => {
  const user = req.user!;
  const siteId = req.query.siteId as string;
  const status = req.query.status as string | undefined;
  const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
  const offset = parseInt(req.query.offset as string, 10) || 0;

  if (!siteId) {
    res.status(400).json({ error: 'siteId query parameter is required' });
    return;
  }

  const auth = authorise(user, 'ai.sessions', siteId);
  if (!auth.allowed) {
    res.status(403).json({ error: auth.reason });
    return;
  }

  try {
    let query = supabaseAdmin
      .from('ai_chat_sessions')
      .select('id, site_id, user_id, title, status, created_at, updated_at', { count: 'exact' })
      .eq('site_id', siteId)
      .eq('user_id', siteUserId(user))
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status === 'active' || status === 'archived') {
      query = query.eq('status', status);
    }

    const { data: sessions, error, count } = await query;

    if (error) {
      console.error('[ai-agent] Sessions fetch error:', error);
      res.status(500).json({ error: 'Failed to fetch sessions' });
      return;
    }

    res.json({
      sessions: sessions ?? [],
      total: count ?? 0,
    });
  } catch (err) {
    console.error('[ai-agent] Sessions error:', err);
    res.status(500).json({ error: 'Internal error fetching sessions' });
  }
});

/**
 * Session manager for Claude Code resume/continuity.
 *
 * Maps ai_chat_sessions to Claude Code session IDs so that:
 * - Users can continue conversations across page navigations
 * - Claude Code can resume with full context from previous turns
 * - Sessions are scoped to site + user
 */
import type { SupabaseClient } from '@supabase/supabase-js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ChatSession {
  id: string;
  siteId: string;
  userId: string;
  title: string;
  sessionResumeId: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

interface SessionRow {
  id: string;
  site_id: string;
  user_id: string;
  title: string;
  session_resume_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

// ─── Session Manager ────────────────────────────────────────────────────────

export class SessionManager {
  constructor(private readonly supabase: SupabaseClient) {}

  /**
   * Get or create a chat session for a user.
   * If sessionId is provided, returns the existing session.
   * Otherwise, creates a new session.
   */
  async getOrCreate(
    siteId: string,
    userId: string,
    sessionId?: string,
    title?: string,
  ): Promise<ChatSession> {
    if (sessionId) {
      const existing = await this.getById(sessionId, siteId, userId);
      if (existing) return existing;
    }

    return this.create(siteId, userId, title ?? 'New conversation');
  }

  /**
   * Get a session by ID, scoped to site and user.
   */
  async getById(
    sessionId: string,
    siteId: string,
    userId: string,
  ): Promise<ChatSession | null> {
    const { data, error } = await this.supabase
      .from('ai_chat_sessions')
      .select('*')
      .eq('id', sessionId)
      .eq('site_id', siteId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .single<SessionRow>();

    if (error || !data) return null;
    return toSession(data);
  }

  /**
   * Create a new chat session.
   */
  async create(
    siteId: string,
    userId: string,
    title: string,
  ): Promise<ChatSession> {
    const { data, error } = await this.supabase
      .from('ai_chat_sessions')
      .insert({
        site_id: siteId,
        user_id: userId,
        title,
        status: 'active',
      })
      .select('*')
      .single<SessionRow>();

    if (error || !data) {
      throw new Error(`[session-manager] Failed to create session: ${error?.message ?? 'unknown'}`);
    }

    return toSession(data);
  }

  /**
   * Update the Claude Code resume ID for a session.
   * Called after each Claude spawn so the next request can resume.
   */
  async updateResumeId(
    sessionId: string,
    resumeId: string,
  ): Promise<void> {
    const { error } = await this.supabase
      .from('ai_chat_sessions')
      .update({ session_resume_id: resumeId })
      .eq('id', sessionId);

    if (error) {
      console.error(`[session-manager] Failed to update resume ID: ${error.message}`);
    }
  }

  /**
   * Update the session title (e.g., from first message or AI summary).
   */
  async updateTitle(sessionId: string, title: string): Promise<void> {
    const { error } = await this.supabase
      .from('ai_chat_sessions')
      .update({ title })
      .eq('id', sessionId);

    if (error) {
      console.error(`[session-manager] Failed to update title: ${error.message}`);
    }
  }

  /**
   * Archive a session (soft delete).
   */
  async archive(sessionId: string, userId: string): Promise<boolean> {
    const { error, count } = await this.supabase
      .from('ai_chat_sessions')
      .update({ status: 'archived' })
      .eq('id', sessionId)
      .eq('user_id', userId);

    if (error) {
      console.error(`[session-manager] Failed to archive session: ${error.message}`);
      return false;
    }

    return (count ?? 0) > 0;
  }

  /**
   * List sessions for a user, ordered by most recent.
   */
  async list(
    siteId: string,
    userId: string,
    opts?: { status?: 'active' | 'archived'; limit?: number; offset?: number },
  ): Promise<{ sessions: ChatSession[]; total: number }> {
    const limit = Math.min(opts?.limit ?? 20, 100);
    const offset = opts?.offset ?? 0;

    let query = this.supabase
      .from('ai_chat_sessions')
      .select('*', { count: 'exact' })
      .eq('site_id', siteId)
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (opts?.status) {
      query = query.eq('status', opts.status);
    }

    const { data, error, count } = await query;

    if (error) {
      throw new Error(`[session-manager] Failed to list sessions: ${error.message}`);
    }

    return {
      sessions: ((data ?? []) as SessionRow[]).map(toSession),
      total: count ?? 0,
    };
  }

  /**
   * Store a chat message in a session.
   */
  async addMessage(
    sessionId: string,
    siteId: string,
    role: 'user' | 'assistant' | 'system',
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('ai_chat_messages')
      .insert({
        session_id: sessionId,
        site_id: siteId,
        role,
        content,
        metadata: metadata ?? null,
      })
      .select('id')
      .single<{ id: string }>();

    if (error || !data) {
      throw new Error(`[session-manager] Failed to store message: ${error?.message ?? 'unknown'}`);
    }

    return data.id;
  }

  /**
   * Get messages for a session, ordered chronologically.
   */
  async getMessages(
    sessionId: string,
    opts?: { limit?: number; offset?: number },
  ): Promise<Array<{
    id: string;
    role: string;
    content: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>> {
    const limit = Math.min(opts?.limit ?? 50, 200);
    const offset = opts?.offset ?? 0;

    const { data, error } = await this.supabase
      .from('ai_chat_messages')
      .select('id, role, content, metadata, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      throw new Error(`[session-manager] Failed to get messages: ${error.message}`);
    }

    return (data ?? []).map((row: { id: string; role: string; content: string; metadata: Record<string, unknown> | null; created_at: string }) => ({
      id: row.id,
      role: row.role,
      content: row.content,
      metadata: row.metadata,
      createdAt: row.created_at,
    }));
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toSession(row: SessionRow): ChatSession {
  return {
    id: row.id,
    siteId: row.site_id,
    userId: row.user_id,
    title: row.title,
    sessionResumeId: row.session_resume_id,
    status: row.status as 'active' | 'archived',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

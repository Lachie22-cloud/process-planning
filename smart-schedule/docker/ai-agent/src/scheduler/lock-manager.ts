/**
 * Distributed lock/lease manager for scheduled task execution.
 *
 * Uses atomic Supabase updates with conditional checks to implement
 * advisory locking. Leases auto-expire after the configured TTL
 * so crashed workers don't hold locks forever.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface LeaseInfo {
  /** Unique lease holder ID for this process */
  holderId: string;
  /** Task ID the lease is for */
  taskId: string;
  /** When the lease was acquired */
  acquiredAt: Date;
  /** When the lease expires */
  expiresAt: Date;
}

export interface LockManagerConfig {
  /** Supabase admin client (service role) */
  supabase: SupabaseClient;
  /** Unique ID for this worker instance */
  workerId?: string;
}

// ─── Lock Manager ───────────────────────────────────────────────────────────

export class LockManager {
  private readonly supabase: SupabaseClient;
  private readonly workerId: string;

  constructor(config: LockManagerConfig) {
    this.supabase = config.supabase;
    this.workerId = config.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
  }

  /**
   * Try to acquire an advisory lease for a scheduled task.
   *
   * Uses an atomic conditional update: only succeeds if the task
   * is not currently locked (lock_key is null or lease has expired).
   *
   * @param taskId - The scheduled task ID
   * @param ttlSeconds - How long the lease is valid
   * @returns LeaseInfo if acquired, null if another worker holds the lock
   */
  async tryAcquire(taskId: string, ttlSeconds: number): Promise<LeaseInfo | null> {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const holderId = `${this.workerId}:${randomUUID().slice(0, 8)}`;

    // Atomic update: acquire lock only if it's free or expired.
    // We use an RPC-style approach: update WHERE lock_key IS NULL
    // OR lock expiry has passed.
    const { data, error } = await this.supabase
      .from('ai_scheduled_tasks')
      .update({
        lock_key: holderId,
        updated_at: now.toISOString(),
      })
      .eq('id', taskId)
      .or(`lock_key.is.null,updated_at.lt.${new Date(now.getTime() - ttlSeconds * 1000).toISOString()}`)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error(`[lock-manager] Failed to acquire lock for task ${taskId}:`, error.message);
      return null;
    }

    if (!data) {
      // Lock held by another worker
      return null;
    }

    console.log(`[lock-manager] Acquired lease for task ${taskId} (holder: ${holderId}, ttl: ${ttlSeconds}s)`);

    return {
      holderId,
      taskId,
      acquiredAt: now,
      expiresAt,
    };
  }

  /**
   * Release an advisory lease after task execution completes.
   *
   * Only releases if the current holder ID matches (prevents
   * releasing another worker's lease after TTL expiry + re-acquisition).
   *
   * @param lease - The lease to release
   * @returns true if released, false if lease was already taken by another worker
   */
  async release(lease: LeaseInfo): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('ai_scheduled_tasks')
      .update({
        lock_key: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', lease.taskId)
      .eq('lock_key', lease.holderId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error(`[lock-manager] Failed to release lock for task ${lease.taskId}:`, error.message);
      return false;
    }

    if (!data) {
      console.warn(`[lock-manager] Lock for task ${lease.taskId} was already released or taken by another worker`);
      return false;
    }

    console.log(`[lock-manager] Released lease for task ${lease.taskId}`);
    return true;
  }

  /**
   * Extend an existing lease (heartbeat).
   * Used for long-running tasks to prevent TTL expiry while still executing.
   *
   * @param lease - The lease to extend
   * @param additionalSeconds - Extra seconds to add from now
   * @returns Updated LeaseInfo if extended, null if lease was lost
   */
  async extend(lease: LeaseInfo, additionalSeconds: number): Promise<LeaseInfo | null> {
    const now = new Date();
    const newExpiry = new Date(now.getTime() + additionalSeconds * 1000);

    const { data, error } = await this.supabase
      .from('ai_scheduled_tasks')
      .update({
        updated_at: now.toISOString(),
      })
      .eq('id', lease.taskId)
      .eq('lock_key', lease.holderId)
      .select('id')
      .maybeSingle();

    if (error || !data) {
      console.warn(`[lock-manager] Failed to extend lease for task ${lease.taskId}: lease lost`);
      return null;
    }

    return {
      ...lease,
      expiresAt: newExpiry,
    };
  }

  /**
   * Clean up stale locks that have exceeded their TTL.
   * Called periodically by the scheduler runner.
   *
   * @param staleTtlSeconds - Consider locks stale after this many seconds
   * @returns Number of stale locks cleaned
   */
  async cleanupStale(staleTtlSeconds: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleTtlSeconds * 1000).toISOString();

    const { data, error } = await this.supabase
      .from('ai_scheduled_tasks')
      .update({
        lock_key: null,
        updated_at: new Date().toISOString(),
      })
      .not('lock_key', 'is', null)
      .lt('updated_at', cutoff)
      .select('id');

    if (error) {
      console.error('[lock-manager] Stale lock cleanup error:', error.message);
      return 0;
    }

    const cleaned = data?.length ?? 0;
    if (cleaned > 0) {
      console.log(`[lock-manager] Cleaned ${cleaned} stale lock(s)`);
    }

    return cleaned;
  }

  /** Get the worker ID for this lock manager instance. */
  getWorkerId(): string {
    return this.workerId;
  }
}

/**
 * Cron scheduler runner for AI scheduled tasks.
 *
 * Responsibilities:
 * - Poll for due tasks at a configurable interval
 * - Evaluate cron expressions in IANA timezones
 * - Acquire advisory locks before execution
 * - Generate deterministic idempotency keys for ai_task_runs
 * - Retry with exponential backoff respecting configured limits
 * - Enforce misfire policies (skip_if_missed vs run_once_on_recovery)
 * - Auto-disable tasks when credentials are invalid/expired
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { getNextRun, getPreviousRun } from './cron-evaluator.js';
import { LockManager } from './lock-manager.js';
import type { LeaseInfo } from './lock-manager.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SchedulerConfig {
  /** Supabase admin client (service role) */
  supabase: SupabaseClient;
  /** How often to poll for due tasks (ms). Default: 30_000 (30s) */
  pollIntervalMs?: number;
  /** Maximum concurrent task executions. Default: 5 */
  maxConcurrent?: number;
  /** Callback to execute a task (triggers AI scan) */
  executeTask: TaskExecutor;
  /** Encryption key for credential decryption */
  encryptionKey: string;
  /** Previous encryption key for rotation scenarios */
  previousEncryptionKey?: string | null;
}

export type TaskExecutor = (ctx: TaskExecutionContext) => Promise<TaskExecutionResult>;

export interface TaskExecutionContext {
  taskId: string;
  siteId: string;
  taskName: string;
  taskType: string;
  customPrompt?: string | null;
  notifyUserIds?: string[] | null;
  createdBy?: string | null;
  runId: string;
  attempt: number;
}

export interface TaskExecutionResult {
  success: boolean;
  error?: string;
  /** Whether the error indicates invalid/expired credentials */
  credentialError?: boolean;
}

interface ScheduledTaskRow {
  id: string;
  site_id: string;
  name: string;
  task_type: string;
  cron_expression: string;
  timezone: string;
  misfire_policy: 'skip_if_missed' | 'run_once_on_recovery';
  lock_ttl_seconds: number;
  retry_max: number;
  retry_backoff_seconds: number;
  custom_prompt: string | null;
  notify_user_ids: string[] | null;
  enabled: boolean;
  lock_key: string | null;
  last_run_at: string | null;
  next_run_at: string | null;
  created_by: string | null;
}

interface CredentialRow {
  id: string;
  site_id: string;
  credential_status: string;
  credential_expires_at: string | null;
  enabled: boolean;
}

// ─── Idempotency Key ────────────────────────────────────────────────────────

/**
 * Generate a deterministic idempotency key from task ID + scheduled-for time.
 * Uses SHA-256 to produce a stable, unique key for each task window.
 *
 * This ensures that even if the scheduler restarts or multiple instances
 * process the same task, only one run record is created per cron window.
 */
export function generateIdempotencyKey(taskId: string, scheduledFor: Date): string {
  const input = `${taskId}:${scheduledFor.toISOString()}`;
  return createHash('sha256').update(input).digest('hex');
}

// ─── Scheduler Runner ───────────────────────────────────────────────────────

export class SchedulerRunner {
  private readonly supabase: SupabaseClient;
  private readonly lockManager: LockManager;
  private readonly pollIntervalMs: number;
  private readonly maxConcurrent: number;
  private readonly executeTask: TaskExecutor;

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private activeRuns = 0;

  constructor(config: SchedulerConfig) {
    this.supabase = config.supabase;
    this.lockManager = new LockManager({ supabase: config.supabase });
    this.pollIntervalMs = config.pollIntervalMs ?? 30_000;
    this.maxConcurrent = config.maxConcurrent ?? 5;
    this.executeTask = config.executeTask;
  }

  /**
   * Start the scheduler polling loop.
   */
  start(): void {
    if (this.running) {
      console.warn('[scheduler] Already running');
      return;
    }

    this.running = true;
    console.log(`[scheduler] Started (poll interval: ${this.pollIntervalMs}ms, max concurrent: ${this.maxConcurrent})`);

    // Run immediately, then on interval
    void this.poll();
    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  /**
   * Stop the scheduler. In-flight tasks continue to completion.
   */
  stop(): void {
    if (!this.running) return;

    this.running = false;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    console.log(`[scheduler] Stopped (${this.activeRuns} task(s) still in-flight)`);
  }

  /**
   * Check if the scheduler is running.
   */
  isRunning(): boolean {
    return this.running;
  }

  // ─── Polling ────────────────────────────────────────────────────────────

  /**
   * Single poll iteration: find due tasks and process them.
   */
  private async poll(): Promise<void> {
    if (!this.running) return;

    try {
      // Clean up stale locks first (max TTL is typically 300s)
      await this.lockManager.cleanupStale(600);

      // Fetch enabled tasks that are due
      const dueTasks = await this.fetchDueTasks();

      if (dueTasks.length === 0) return;

      console.log(`[scheduler] Found ${dueTasks.length} due task(s)`);

      for (const task of dueTasks) {
        if (!this.running) break;
        if (this.activeRuns >= this.maxConcurrent) {
          console.log(`[scheduler] At concurrency limit (${this.maxConcurrent}), deferring remaining tasks`);
          break;
        }

        // Fire and forget — errors are handled inside processTask
        void this.processTask(task);
      }
    } catch (err) {
      console.error('[scheduler] Poll error:', err instanceof Error ? err.message : err);
    }
  }

  /**
   * Fetch enabled scheduled tasks that are due for execution.
   */
  private async fetchDueTasks(): Promise<ScheduledTaskRow[]> {
    const now = new Date().toISOString();

    // Do NOT filter on lock_key here — include tasks with expired leases.
    // The LockManager.tryAcquire() atomically checks lock ownership and TTL
    // expiry per task, so locked-but-expired tasks are properly reconsidered.
    const { data, error } = await this.supabase
      .from('ai_scheduled_tasks')
      .select('id, site_id, name, task_type, cron_expression, timezone, misfire_policy, lock_ttl_seconds, retry_max, retry_backoff_seconds, custom_prompt, notify_user_ids, enabled, lock_key, last_run_at, next_run_at, created_by')
      .eq('enabled', true)
      .or(`next_run_at.is.null,next_run_at.lte.${now}`)
      .limit(this.maxConcurrent * 2);

    if (error) {
      console.error('[scheduler] Fetch due tasks error:', error.message);
      return [];
    }

    return (data ?? []) as ScheduledTaskRow[];
  }

  // ─── Task Processing ───────────────────────────────────────────────────

  /**
   * Process a single scheduled task: acquire lock, check credentials,
   * handle misfires, create run record, execute, and update state.
   */
  private async processTask(task: ScheduledTaskRow): Promise<void> {
    this.activeRuns++;

    let lease: LeaseInfo | null = null;

    try {
      // 1. Acquire advisory lock
      lease = await this.lockManager.tryAcquire(task.id, task.lock_ttl_seconds);
      if (!lease) {
        console.log(`[scheduler] Task ${task.name} locked by another worker, skipping`);
        return;
      }

      // 2. Validate credentials for the site
      const credValid = await this.checkCredentials(task.site_id);
      if (!credValid) {
        await this.autoDisableTask(task.id, task.site_id, task.name);
        return;
      }

      // 3. Determine scheduled-for time (handles misfires)
      const scheduledFor = this.resolveScheduledFor(task);
      if (!scheduledFor) {
        console.log(`[scheduler] Task ${task.name}: no scheduled time resolved (skipping)`);
        await this.updateNextRun(task);
        return;
      }

      // 4. Generate deterministic idempotency key
      const idempotencyKey = generateIdempotencyKey(task.id, scheduledFor);

      // 5. Create or find existing run record (idempotent)
      const runId = await this.ensureRunRecord(task, scheduledFor, idempotencyKey);
      if (!runId) {
        // Run already exists and completed/running — skip
        console.log(`[scheduler] Task ${task.name}: run already exists for ${scheduledFor.toISOString()}`);
        await this.updateNextRun(task);
        return;
      }

      // 6. Execute with retry (pass lease for heartbeat extension)
      lease = await this.executeWithRetry(task, runId, scheduledFor, lease);

      // 7. Update next_run_at for future polls
      await this.updateNextRun(task);

    } catch (err) {
      console.error(`[scheduler] Task ${task.name} processing error:`, err instanceof Error ? err.message : err);
    } finally {
      // Always release the lock
      if (lease) {
        await this.lockManager.release(lease);
      }
      this.activeRuns--;
    }
  }

  // ─── Credential Validation ─────────────────────────────────────────────

  /**
   * Check if the site has valid, non-expired credentials.
   * Returns false if credentials are invalid/expired/missing.
   */
  private async checkCredentials(siteId: string): Promise<boolean> {
    const { data, error } = await this.supabase
      .from('ai_config')
      .select('id, site_id, credential_status, credential_expires_at, enabled')
      .eq('site_id', siteId)
      .single() as { data: CredentialRow | null; error: { message: string } | null };

    if (error || !data) {
      console.warn(`[scheduler] No AI config found for site ${siteId}`);
      return false;
    }

    if (!data.enabled) {
      console.warn(`[scheduler] AI config disabled for site ${siteId}`);
      return false;
    }

    // Check credential status
    if (data.credential_status === 'invalid' || data.credential_status === 'expired') {
      console.warn(`[scheduler] Credentials ${data.credential_status} for site ${siteId}`);
      return false;
    }

    // Check expiry
    if (data.credential_expires_at) {
      const expiresAt = new Date(data.credential_expires_at);
      if (expiresAt <= new Date()) {
        console.warn(`[scheduler] Credentials expired for site ${siteId}`);
        // Update status to expired
        await this.supabase
          .from('ai_config')
          .update({
            credential_status: 'expired',
            updated_at: new Date().toISOString(),
          })
          .eq('site_id', siteId);
        return false;
      }
    }

    return true;
  }

  /**
   * Auto-disable a scheduled task when credentials are invalid/expired.
   * Logs an audit entry and updates the task's last_error.
   */
  private async autoDisableTask(taskId: string, siteId: string, taskName: string): Promise<void> {
    const reason = 'Auto-disabled: site credentials are invalid or expired';

    await this.supabase
      .from('ai_scheduled_tasks')
      .update({
        enabled: false,
        last_error: reason,
        lock_key: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId);

    // Audit log
    await this.supabase.from('audit_log').insert({
      site_id: siteId,
      action: 'ai_task_auto_disabled',
      details: {
        task_id: taskId,
        task_name: taskName,
        reason,
      },
    });

    console.warn(`[scheduler] Auto-disabled task "${taskName}" (${taskId}): ${reason}`);
  }

  // ─── Misfire Policy ────────────────────────────────────────────────────

  /**
   * Resolve the scheduled-for time, applying the misfire policy.
   *
   * - skip_if_missed: If the task was supposed to run but missed its window,
   *   skip it and just update next_run_at.
   * - run_once_on_recovery: Run the most recent missed execution once.
   */
  private resolveScheduledFor(task: ScheduledTaskRow): Date | null {
    const now = new Date();

    if (task.next_run_at) {
      const nextRun = new Date(task.next_run_at);

      // Not yet due
      if (nextRun > now) return null;

      // Check if this is a misfire (significantly past due)
      const misfireThresholdMs = task.lock_ttl_seconds * 1000 * 2; // 2x the TTL
      const misfired = now.getTime() - nextRun.getTime() > misfireThresholdMs;

      if (misfired) {
        if (task.misfire_policy === 'skip_if_missed') {
          console.log(`[scheduler] Task ${task.name}: misfire detected, skipping (policy: skip_if_missed)`);
          return null;
        }

        // run_once_on_recovery: use the most recent missed scheduled time
        const previousRun = getPreviousRun(task.cron_expression, task.timezone, now);
        if (previousRun) {
          console.log(`[scheduler] Task ${task.name}: misfire recovery, running for ${previousRun.toISOString()} (policy: run_once_on_recovery)`);
          return previousRun;
        }
      }

      return nextRun;
    }

    // No next_run_at set — first run or recovery
    if (task.misfire_policy === 'run_once_on_recovery') {
      const previousRun = getPreviousRun(task.cron_expression, task.timezone, now);
      if (previousRun && task.last_run_at) {
        const lastRun = new Date(task.last_run_at);
        if (previousRun > lastRun) {
          return previousRun;
        }
      }
    }

    // Calculate next run from now
    const nextRun = getNextRun(task.cron_expression, task.timezone, now);
    return nextRun && nextRun <= now ? nextRun : null;
  }

  // ─── Run Record Management ─────────────────────────────────────────────

  /**
   * Create an ai_task_runs record, using the idempotency key to
   * prevent duplicate runs. Returns the run ID if a new record was
   * created, or null if the run already exists and shouldn't be re-executed.
   */
  private async ensureRunRecord(
    task: ScheduledTaskRow,
    scheduledFor: Date,
    idempotencyKey: string,
  ): Promise<string | null> {
    // Check for existing run with this idempotency key
    const { data: existing } = await this.supabase
      .from('ai_task_runs')
      .select('id, status')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    if (existing) {
      // Already completed or currently running
      if (existing.status === 'completed' || existing.status === 'running') {
        return null;
      }

      // Failed run — check if we should retry
      if (existing.status === 'failed') {
        // Retry handled by executeWithRetry
        return existing.id as string;
      }

      // Pending or skipped — take it
      return existing.id as string;
    }

    // Insert new run record
    const { data: newRun, error } = await this.supabase
      .from('ai_task_runs')
      .insert({
        task_id: task.id,
        site_id: task.site_id,
        scheduled_for: scheduledFor.toISOString(),
        idempotency_key: idempotencyKey,
        status: 'pending',
        attempt: 0,
      })
      .select('id')
      .single();

    if (error) {
      // Unique constraint violation = another worker beat us
      if (error.code === '23505') {
        console.log(`[scheduler] Run record already created by another worker (key: ${idempotencyKey.slice(0, 12)}...)`);
        return null;
      }

      console.error(`[scheduler] Failed to create run record:`, error.message);
      return null;
    }

    return newRun.id as string;
  }

  // ─── Execution with Retry ──────────────────────────────────────────────

  /**
   * Execute a task with retry and exponential backoff.
   *
   * Respects the task's retry_max and retry_backoff_seconds configuration.
   * On credential errors, auto-disables the task instead of retrying.
   * Extends the lease heartbeat during execution and backoff waits so
   * a running task does not lose its lease and get double-executed.
   *
   * @returns The current lease (may have been extended), or the original
   *          lease if extension was not needed.
   */
  private async executeWithRetry(
    task: ScheduledTaskRow,
    runId: string,
    scheduledFor: Date,
    lease: LeaseInfo,
  ): Promise<LeaseInfo> {
    const startedAt = new Date();
    let currentLease = lease;

    // Get current attempt count
    const { data: runData } = await this.supabase
      .from('ai_task_runs')
      .select('attempt')
      .eq('id', runId)
      .single();

    let attempt = (runData?.attempt as number | undefined) ?? 0;

    while (attempt <= task.retry_max) {
      attempt++;

      // Extend the lease before each attempt to ensure we have a full TTL window
      const extended = await this.lockManager.extend(currentLease, task.lock_ttl_seconds);
      if (!extended) {
        console.warn(`[scheduler] Lost lease before attempt ${attempt} for task "${task.name}"`);
        await this.supabase
          .from('ai_task_runs')
          .update({ status: 'failed', error: 'Lost lease', finished_at: new Date().toISOString() })
          .eq('id', runId);
        return currentLease;
      }
      currentLease = extended;

      // Update run status to running
      await this.supabase
        .from('ai_task_runs')
        .update({
          status: 'running',
          attempt,
          started_at: new Date().toISOString(),
          error: null,
        })
        .eq('id', runId);

      console.log(`[scheduler] Executing task "${task.name}" (run: ${runId}, attempt: ${attempt}/${task.retry_max + 1})`);

      try {
        const result = await this.executeTaskWithHeartbeat(
          currentLease,
          task.lock_ttl_seconds,
          {
            taskId: task.id,
            siteId: task.site_id,
            taskName: task.name,
            taskType: task.task_type,
            customPrompt: task.custom_prompt,
            notifyUserIds: task.notify_user_ids,
            createdBy: task.created_by,
            runId,
            attempt,
          },
        );

        // Update lease from heartbeat result
        if (result.lease) {
          currentLease = result.lease;
        }

        if (result.taskResult.success) {
          // Success — mark completed
          const finishedAt = new Date();
          const durationMs = finishedAt.getTime() - startedAt.getTime();

          await this.supabase
            .from('ai_task_runs')
            .update({
              status: 'completed',
              finished_at: finishedAt.toISOString(),
              error: null,
            })
            .eq('id', runId);

          // Update task metadata
          await this.supabase
            .from('ai_scheduled_tasks')
            .update({
              last_run_at: scheduledFor.toISOString(),
              last_error: null,
              last_run_duration_ms: durationMs,
              updated_at: new Date().toISOString(),
            })
            .eq('id', task.id);

          console.log(`[scheduler] Task "${task.name}" completed in ${durationMs}ms`);
          return currentLease;
        }

        // Failure
        if (result.taskResult.credentialError) {
          // Credential error: auto-disable, don't retry
          await this.supabase
            .from('ai_task_runs')
            .update({
              status: 'failed',
              finished_at: new Date().toISOString(),
              error: result.taskResult.error ?? 'Credential error',
            })
            .eq('id', runId);

          await this.autoDisableTask(task.id, task.site_id, task.name);
          return currentLease;
        }

        // Record the failure
        await this.supabase
          .from('ai_task_runs')
          .update({
            status: 'failed',
            error: result.taskResult.error ?? 'Unknown error',
            finished_at: new Date().toISOString(),
          })
          .eq('id', runId);

        // Check if we can retry
        if (attempt > task.retry_max) {
          console.error(`[scheduler] Task "${task.name}" failed after ${attempt} attempt(s): ${result.taskResult.error}`);

          await this.supabase
            .from('ai_scheduled_tasks')
            .update({
              last_run_at: scheduledFor.toISOString(),
              last_error: result.taskResult.error ?? 'Unknown error',
              updated_at: new Date().toISOString(),
            })
            .eq('id', task.id);

          return currentLease;
        }

        // Exponential backoff with lease heartbeat: base * 2^(attempt-1)
        const backoffMs = task.retry_backoff_seconds * 1000 * Math.pow(2, attempt - 1);
        console.log(`[scheduler] Task "${task.name}" failed, retrying in ${backoffMs / 1000}s (attempt ${attempt}/${task.retry_max + 1})`);
        const leaseAfterBackoff = await this.sleepWithHeartbeat(backoffMs, currentLease, task.lock_ttl_seconds);
        if (!leaseAfterBackoff) {
          console.warn(`[scheduler] Lost lease during backoff for task "${task.name}"`);
          return currentLease;
        }
        currentLease = leaseAfterBackoff;

      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        await this.supabase
          .from('ai_task_runs')
          .update({
            status: 'failed',
            error: errorMsg,
            finished_at: new Date().toISOString(),
          })
          .eq('id', runId);

        if (attempt > task.retry_max) {
          console.error(`[scheduler] Task "${task.name}" threw after ${attempt} attempt(s): ${errorMsg}`);

          await this.supabase
            .from('ai_scheduled_tasks')
            .update({
              last_run_at: scheduledFor.toISOString(),
              last_error: errorMsg,
              updated_at: new Date().toISOString(),
            })
            .eq('id', task.id);

          return currentLease;
        }

        const backoffMs = task.retry_backoff_seconds * 1000 * Math.pow(2, attempt - 1);
        console.log(`[scheduler] Task "${task.name}" threw, retrying in ${backoffMs / 1000}s`);
        const leaseAfterBackoff = await this.sleepWithHeartbeat(backoffMs, currentLease, task.lock_ttl_seconds);
        if (!leaseAfterBackoff) {
          console.warn(`[scheduler] Lost lease during backoff for task "${task.name}"`);
          return currentLease;
        }
        currentLease = leaseAfterBackoff;
      }
    }

    return currentLease;
  }

  /**
   * Execute a task with a background heartbeat that extends the lease
   * at 1/3 of the TTL interval, preventing lease expiry during long-running tasks.
   */
  private async executeTaskWithHeartbeat(
    lease: LeaseInfo,
    ttlSeconds: number,
    ctx: TaskExecutionContext,
  ): Promise<{ taskResult: TaskExecutionResult; lease: LeaseInfo | null }> {
    const heartbeatMs = Math.max(Math.floor((ttlSeconds * 1000) / 3), 5_000);
    let currentLease: LeaseInfo | null = lease;

    const heartbeat = setInterval(() => {
      if (!currentLease) return;
      void this.lockManager.extend(currentLease, ttlSeconds).then((extended) => {
        if (extended) {
          currentLease = extended;
        } else {
          console.warn(`[scheduler] Heartbeat lost lease for task ${ctx.taskId}`);
          currentLease = null;
        }
      });
    }, heartbeatMs);

    try {
      const taskResult = await this.executeTask(ctx);
      return { taskResult, lease: currentLease };
    } finally {
      clearInterval(heartbeat);
    }
  }

  /**
   * Sleep with periodic lease heartbeat extension.
   * Returns the current lease after sleeping, or null if the lease was lost.
   */
  private async sleepWithHeartbeat(
    ms: number,
    lease: LeaseInfo,
    ttlSeconds: number,
  ): Promise<LeaseInfo | null> {
    const heartbeatMs = Math.max(Math.floor((ttlSeconds * 1000) / 3), 5_000);
    let remaining = ms;
    let currentLease: LeaseInfo | null = lease;

    while (remaining > 0 && currentLease) {
      const sleepTime = Math.min(remaining, heartbeatMs);
      await sleep(sleepTime);
      remaining -= sleepTime;

      // Extend lease after each heartbeat interval
      if (currentLease) {
        const extended = await this.lockManager.extend(currentLease, ttlSeconds);
        if (!extended) {
          return null;
        }
        currentLease = extended;
      }
    }

    return currentLease;
  }

  // ─── Next Run Update ───────────────────────────────────────────────────

  /**
   * Update the next_run_at field for a task based on its cron expression.
   */
  private async updateNextRun(task: ScheduledTaskRow): Promise<void> {
    const nextRun = getNextRun(task.cron_expression, task.timezone);

    if (!nextRun) {
      console.warn(`[scheduler] Could not calculate next run for task ${task.name}`);
      return;
    }

    await this.supabase
      .from('ai_scheduled_tasks')
      .update({
        next_run_at: nextRun.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', task.id);
  }
}

// ─── Utilities ──────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

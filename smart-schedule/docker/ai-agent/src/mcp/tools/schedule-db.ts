/**
 * Schedule database MCP tools.
 *
 * Provides read access to production schedule data and write access
 * through the draft proposal system (never direct mutations).
 * All queries are scoped to the configured site_id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { scoringTools, handleScoringTool } from './scoring.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

type ToolHandler = (
  args: Record<string, unknown>,
  supabase: SupabaseClient,
  siteId: string,
) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;

// ─── Tool Definitions ───────────────────────────────────────────────────────

const baseScheduleDbTools: ToolDefinition[] = [
  {
    name: 'query_batches',
    description:
      'Query production batches with optional filters. Returns batch details ' +
      'including SAP order, material, plan date, resource assignment, and status.',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by batch status (e.g., planned, in_progress, completed)',
        },
        plan_date_from: {
          type: 'string',
          description: 'Filter batches planned on or after this date (YYYY-MM-DD)',
        },
        plan_date_to: {
          type: 'string',
          description: 'Filter batches planned on or before this date (YYYY-MM-DD)',
        },
        resource_id: {
          type: 'string',
          description: 'Filter by assigned resource UUID',
        },
        rm_available: {
          type: 'boolean',
          description: 'Filter by raw material availability. Set false to find WOM (Waiting On Materials) batches.',
        },
        packaging_available: {
          type: 'boolean',
          description: 'Filter by packaging availability. Set false to find WOP (Waiting On Packaging) batches.',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default: 50, max: 200)',
        },
      },
    },
  },
  {
    name: 'query_resources',
    description:
      'Query available resources (mixers, equipment) for the site. ' +
      'Returns resource details including capacity, type, and active status.',
    inputSchema: {
      type: 'object',
      properties: {
        resource_type: {
          type: 'string',
          description: 'Filter by resource type (e.g., mixer)',
        },
        active_only: {
          type: 'boolean',
          description: 'Only return active resources (default: true)',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default: 100, max: 200)',
        },
      },
    },
  },
  {
    name: 'query_substitution_rules',
    description:
      'Query resource substitution rules. Shows which resources can ' +
      'substitute for others, with conditions.',
    inputSchema: {
      type: 'object',
      properties: {
        source_resource_id: {
          type: 'string',
          description: 'Filter by source resource UUID',
        },
        target_resource_id: {
          type: 'string',
          description: 'Filter by target resource UUID',
        },
        enabled_only: {
          type: 'boolean',
          description: 'Only return enabled rules (default: true)',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default: 100, max: 200)',
        },
      },
    },
  },
  {
    name: 'get_schedule_summary',
    description:
      'Get aggregate schedule statistics: batch counts by status, ' +
      'resource utilization, and date range coverage.',
    inputSchema: {
      type: 'object',
      properties: {
        date_from: {
          type: 'string',
          description: 'Start date for summary period (YYYY-MM-DD)',
        },
        date_to: {
          type: 'string',
          description: 'End date for summary period (YYYY-MM-DD)',
        },
      },
    },
  },
  {
    name: 'create_draft',
    description:
      'Create a draft proposal for human review. Drafts are NEVER applied ' +
      'automatically — they require explicit approval. Types: schedule_change, ' +
      'rule_suggestion, resource_rebalance.',
    inputSchema: {
      type: 'object',
      properties: {
        scan_id: {
          type: 'string',
          description: 'UUID of the parent scan (if triggered by a scan)',
        },
        draft_type: {
          type: 'string',
          enum: ['schedule_change', 'rule_suggestion', 'resource_rebalance'],
          description: 'Type of draft proposal',
        },
        title: {
          type: 'string',
          description: 'Short title describing the proposal',
        },
        description: {
          type: 'string',
          description: 'Detailed explanation of the proposed changes and reasoning',
        },
        payload: {
          type: 'object',
          description:
            'Structured mutation payload. For schedule_change: { changes: [{ batch_id, plan_date?, plan_resource_id?, status? }] }. ' +
            'For rule_suggestion: { rules: [{ source_resource_id, target_resource_id, conditions? }] }. ' +
            'For resource_rebalance: { assignments: [{ batch_id, new_resource_id }] }.',
        },
      },
      required: ['draft_type', 'title', 'description', 'payload'],
    },
  },
  {
    name: 'update_scan_status',
    description:
      'Update the status and report of an AI scan. Used to record progress ' +
      'and results during scan execution.',
    inputSchema: {
      type: 'object',
      properties: {
        scan_id: {
          type: 'string',
          description: 'UUID of the scan to update',
        },
        status: {
          type: 'string',
          enum: ['running', 'completed', 'failed', 'cancelled'],
          description: 'New scan status',
        },
        report: {
          type: 'object',
          description: 'Scan results/report data (JSON)',
        },
        error_message: {
          type: 'string',
          description: 'Error message if scan failed',
        },
      },
      required: ['scan_id', 'status'],
    },
  },
];

/**
 * Unified tool list consumed by the runtime spawner.
 * Includes base schedule-db tools plus deterministic scoring tools.
 */
export const scheduleDbTools: ToolDefinition[] = [
  ...baseScheduleDbTools,
  ...scoringTools,
];

// ─── Tool Handlers ──────────────────────────────────────────────────────────

const handlers: Record<string, ToolHandler> = {
  query_batches: async (args, supabase, siteId) => {
    const limit = Math.min(Number(args.limit) || 50, 200);

    let query = supabase
      .from('batches')
      .select(
        'id, sap_order, material_code, material_description, bulk_code, ' +
        'plan_date, plan_resource_id, batch_volume, status, ' +
        'vetting_status, rm_available, packaging_available, stock_cover',
      )
      .eq('site_id', siteId)
      .order('plan_date', { ascending: true })
      .limit(limit);

    if (typeof args.status === 'string') {
      query = query.eq('status', args.status);
    }
    if (typeof args.plan_date_from === 'string') {
      query = query.gte('plan_date', args.plan_date_from);
    }
    if (typeof args.plan_date_to === 'string') {
      query = query.lte('plan_date', args.plan_date_to);
    }
    if (typeof args.resource_id === 'string') {
      query = query.eq('plan_resource_id', args.resource_id);
    }
    if (typeof args.rm_available === 'boolean') {
      query = query.eq('rm_available', args.rm_available);
    }
    if (typeof args.packaging_available === 'boolean') {
      query = query.eq('packaging_available', args.packaging_available);
    }

    const { data, error } = await query;

    if (error) {
      return textResult(`Error querying batches: ${error.message}`);
    }

    return textResult(JSON.stringify(data ?? [], null, 2));
  },

  query_resources: async (args, supabase, siteId) => {
    const limit = Math.min(Number(args.limit) || 100, 200);
    const activeOnly = args.active_only !== false;

    let query = supabase
      .from('resources')
      .select(
        'id, resource_code, resource_type, display_name, trunk_line, ' +
        'group_name, min_capacity, max_capacity, max_batches_per_day, ' +
        'chemical_base, sort_order, active',
      )
      .eq('site_id', siteId)
      .order('sort_order', { ascending: true })
      .limit(limit);

    if (activeOnly) {
      query = query.eq('active', true);
    }
    if (typeof args.resource_type === 'string') {
      query = query.eq('resource_type', args.resource_type);
    }

    const { data, error } = await query;

    if (error) {
      return textResult(`Error querying resources: ${error.message}`);
    }

    return textResult(JSON.stringify(data ?? [], null, 2));
  },

  query_substitution_rules: async (args, supabase, siteId) => {
    const limit = Math.min(Number(args.limit) || 100, 200);
    const enabledOnly = args.enabled_only !== false;

    let query = supabase
      .from('substitution_rules')
      .select('id, source_resource_id, target_resource_id, conditions, enabled, created_at')
      .eq('site_id', siteId)
      .limit(limit);

    if (enabledOnly) {
      query = query.eq('enabled', true);
    }
    if (typeof args.source_resource_id === 'string') {
      query = query.eq('source_resource_id', args.source_resource_id);
    }
    if (typeof args.target_resource_id === 'string') {
      query = query.eq('target_resource_id', args.target_resource_id);
    }

    const { data, error } = await query;

    if (error) {
      return textResult(`Error querying substitution rules: ${error.message}`);
    }

    return textResult(JSON.stringify(data ?? [], null, 2));
  },

  get_schedule_summary: async (args, supabase, siteId) => {
    // Batch counts by status
    let batchQuery = supabase
      .from('batches')
      .select('status', { count: 'exact' })
      .eq('site_id', siteId);

    if (typeof args.date_from === 'string') {
      batchQuery = batchQuery.gte('plan_date', args.date_from);
    }
    if (typeof args.date_to === 'string') {
      batchQuery = batchQuery.lte('plan_date', args.date_to);
    }

    const { data: batches, error: batchError } = await batchQuery;

    if (batchError) {
      return textResult(`Error getting schedule summary: ${batchError.message}`);
    }

    // Count by status
    const statusCounts: Record<string, number> = {};
    for (const row of batches ?? []) {
      const status = (row as Record<string, unknown>).status as string;
      statusCounts[status] = (statusCounts[status] ?? 0) + 1;
    }

    // Resource count
    const { count: resourceCount } = await supabase
      .from('resources')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('active', true);

    // Active rules count
    const { count: rulesCount } = await supabase
      .from('substitution_rules')
      .select('id', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('enabled', true);

    const summary = {
      total_batches: batches?.length ?? 0,
      batches_by_status: statusCounts,
      active_resources: resourceCount ?? 0,
      active_substitution_rules: rulesCount ?? 0,
      date_range: {
        from: args.date_from ?? 'all',
        to: args.date_to ?? 'all',
      },
    };

    return textResult(JSON.stringify(summary, null, 2));
  },

  create_draft: async (args, supabase, siteId) => {
    const { draft_type, title, description, payload, scan_id } = args;

    if (!draft_type || !title || !description || !payload) {
      return textResult('Error: draft_type, title, description, and payload are all required.');
    }

    const insertData: Record<string, unknown> = {
      site_id: siteId,
      draft_type,
      title,
      description,
      payload,
      status: 'pending',
    };

    if (typeof scan_id === 'string') {
      insertData.scan_id = scan_id;
    }

    const { data, error } = await supabase
      .from('ai_drafts')
      .insert(insertData)
      .select('id, draft_type, title, status, created_at')
      .single();

    if (error) {
      return textResult(`Error creating draft: ${error.message}`);
    }

    return textResult(
      `Draft created successfully:\n${JSON.stringify(data, null, 2)}\n\n` +
      'This draft is now pending human review and approval.',
    );
  },

  update_scan_status: async (args, supabase, siteId) => {
    const { scan_id, status, report, error_message } = args;

    if (!scan_id || !status) {
      return textResult('Error: scan_id and status are required.');
    }

    const updateData: Record<string, unknown> = { status };

    if (status === 'running') {
      updateData.started_at = new Date().toISOString();
    }
    if (status === 'completed' || status === 'failed') {
      updateData.completed_at = new Date().toISOString();
    }
    if (report !== undefined) {
      updateData.report = report;
    }
    if (typeof error_message === 'string') {
      updateData.error_message = error_message;
    }

    const { data, error } = await supabase
      .from('ai_scans')
      .update(updateData)
      .eq('id', scan_id as string)
      .eq('site_id', siteId)
      .select('id, scan_type, status, started_at, completed_at')
      .single();

    if (error) {
      return textResult(`Error updating scan: ${error.message}`);
    }

    return textResult(`Scan updated:\n${JSON.stringify(data, null, 2)}`);
  },
};

// ─── Context-Scoped Tool Getters ─────────────────────────────────────────────

/** Scan-lifecycle tools that must NOT be exposed in the chat context. */
const SCAN_ONLY_TOOLS = new Set(['update_scan_status']);

/**
 * Tools for the chat context.
 * Excludes scan lifecycle tools (e.g. update_scan_status) that are irrelevant
 * and potentially confusing for a conversational agent.
 */
export function getChatTools(): ToolDefinition[] {
  return scheduleDbTools.filter((t) => !SCAN_ONLY_TOOLS.has(t.name));
}

/**
 * Tools for the scan context.
 * Includes all tools, including update_scan_status.
 */
export function getScanTools(): ToolDefinition[] {
  return scheduleDbTools;
}

// ─── Handler Dispatch ───────────────────────────────────────────────────────

/**
 * Execute a schedule-db tool by name.
 */
export async function handleScheduleDbTool(
  toolName: string,
  args: Record<string, unknown>,
  supabase: SupabaseClient,
  siteId: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const handler = handlers[toolName];
  if (handler) {
    return handler(args, supabase, siteId);
  }

  // Delegate deterministic scoring tools to their dedicated handler.
  return handleScoringTool(toolName, args, supabase, siteId);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function textResult(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

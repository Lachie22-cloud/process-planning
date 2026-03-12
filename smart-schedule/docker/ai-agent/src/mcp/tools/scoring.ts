/**
 * Scoring MCP tools.
 *
 * Provides read-only deterministic scoring tools for placement evaluation,
 * schedule health analysis, best-move recommendations, move simulation,
 * and colour transition queries.
 *
 * All queries are scoped to the configured site_id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolDefinition } from './schedule-db.js';
import type {
  ColourGroup,
  ColourTransition,
  HealthScoringContext,
  ScoringBatch,
  ScoringContext,
  ScoringResource,
  ScoringResourceBlock,
  ScoringSubstitutionRule,
  ScoringWeights,
} from '../../scoring/types.js';
import { PlacementScorer, extractWeights } from '../../scoring/placement-scorer.js';
import { HealthScorer } from '../../scoring/health-scorer.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const scoringTools: ToolDefinition[] = [
  {
    name: 'score_placement',
    description:
      'Score placement options for a specific batch on one or more resources for a target date. ' +
      'Returns deterministic PlacementScore with hard constraint checks and soft factor breakdowns. ' +
      'Read-only – does not modify data.',
    inputSchema: {
      type: 'object',
      properties: {
        batch_id: {
          type: 'string',
          description: 'UUID of the batch to score',
        },
        resource_id: {
          type: 'string',
          description: 'UUID of the target resource (omit to score all active resources)',
        },
        target_date: {
          type: 'string',
          description: 'Target placement date (YYYY-MM-DD). Defaults to batch plan_date.',
        },
      },
      required: ['batch_id'],
    },
  },
  {
    name: 'score_health',
    description:
      'Generate a full deterministic health report for the schedule. Returns overall score (5–100), ' +
      'typed issues with severity, and suggested corrective actions. ' +
      'Read-only – does not modify data.',
    inputSchema: {
      type: 'object',
      properties: {
        date_from: {
          type: 'string',
          description: 'Start date for evaluation period (YYYY-MM-DD)',
        },
        date_to: {
          type: 'string',
          description: 'End date for evaluation period (YYYY-MM-DD)',
        },
      },
    },
  },
  {
    name: 'find_best_move',
    description:
      'Find the top 5 best placement options for a batch across all active resources. ' +
      'Returns ranked list with full score breakdowns. ' +
      'Read-only – does not modify data.',
    inputSchema: {
      type: 'object',
      properties: {
        batch_id: {
          type: 'string',
          description: 'UUID of the batch to find best placements for',
        },
        target_date: {
          type: 'string',
          description: 'Target date (YYYY-MM-DD). Defaults to batch plan_date or today.',
        },
        exclude_current: {
          type: 'boolean',
          description: 'Exclude the current resource assignment (default: false)',
        },
      },
      required: ['batch_id'],
    },
  },
  {
    name: 'simulate_move',
    description:
      'Simulate moving a batch to a new resource/date and return the health score delta ' +
      'without actually mutating data. Shows before/after scores and issue changes. ' +
      'Read-only – does not modify data.',
    inputSchema: {
      type: 'object',
      properties: {
        batch_id: {
          type: 'string',
          description: 'UUID of the batch to move',
        },
        target_resource_id: {
          type: 'string',
          description: 'UUID of the destination resource',
        },
        target_date: {
          type: 'string',
          description: 'Target date for the move (YYYY-MM-DD). Defaults to batch plan_date.',
        },
      },
      required: ['batch_id', 'target_resource_id'],
    },
  },
  {
    name: 'rank_wom_batches',
    description:
      'Rank all WOM (Waiting On Materials) and WOP (Waiting On Packaging) batches by reschedule priority. ' +
      'Returns a deterministic ranked list with urgency scores, PO expected delivery dates, and top ' +
      'recommended resource×date options per batch. Use this to answer questions like ' +
      '"which WOM batches should I reschedule first". Read-only – does not modify data.',
    inputSchema: {
      type: 'object',
      properties: {
        include_wom: {
          type: 'boolean',
          description: 'Include WOM batches (rm_available=false). Default: true.',
        },
        include_wop: {
          type: 'boolean',
          description: 'Include WOP batches (packaging_available=false). Default: true.',
        },
        date_from: {
          type: 'string',
          description: 'Filter batches planned on or after this date (YYYY-MM-DD)',
        },
        date_to: {
          type: 'string',
          description: 'Filter batches planned on or before this date (YYYY-MM-DD)',
        },
        limit: {
          type: 'number',
          description: 'Max batches to return (default: 20, max: 50)',
        },
        top_options: {
          type: 'number',
          description: 'Number of recommended resource×date options per batch (default: 3, max: 5)',
        },
      },
    },
  },
  {
    name: 'query_colour_transitions',
    description:
      'Query the colour transition matrix with group details. Returns all transition rules ' +
      'with from/to group names, allowed status, and washout requirements. ' +
      'Read-only – does not modify data.',
    inputSchema: {
      type: 'object',
      properties: {
        from_group_code: {
          type: 'string',
          description: 'Filter by source colour group code (e.g. "WHITE")',
        },
        to_group_code: {
          type: 'string',
          description: 'Filter by destination colour group code',
        },
        allowed_only: {
          type: 'boolean',
          description: 'Only return allowed transitions (default: false)',
        },
        limit: {
          type: 'number',
          description: 'Max rows to return (default: 200)',
        },
      },
    },
  },
];

// ─── Data fetching helpers ─────────────────────────────────────────────────

async function fetchBatchById(
  supabase: SupabaseClient,
  siteId: string,
  batchId: string,
): Promise<ScoringBatch | null> {
  const { data, error } = await supabase
    .from('batches')
    .select(
      'id, batch_volume, sap_color_group, status, ' +
      'rm_available, packaging_available, plan_resource_id, plan_date, bulk_code, ' +
      'po_date, stock_cover, material_description',
    )
    .eq('id', batchId)
    .eq('site_id', siteId)
    .single();

  if (error || !data) return null;
  return mapDbBatch(data as unknown as Record<string, unknown>);
}

async function fetchBatches(
  supabase: SupabaseClient,
  siteId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<ScoringBatch[]> {
  let query = supabase
    .from('batches')
    .select(
      'id, batch_volume, sap_color_group, status, ' +
      'rm_available, packaging_available, plan_resource_id, plan_date, bulk_code, ' +
      'po_date, stock_cover, material_description',
    )
    .eq('site_id', siteId)
    .order('plan_date', { ascending: true })
    .limit(2000);

  if (dateFrom) query = query.gte('plan_date', dateFrom);
  if (dateTo) query = query.lte('plan_date', dateTo);

  const { data } = await query;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(mapDbBatch);
}

async function fetchResources(
  supabase: SupabaseClient,
  siteId: string,
): Promise<ScoringResource[]> {
  const { data } = await supabase
    .from('resources')
    .select(
      'id, min_capacity, max_capacity, max_batches_per_day, ' +
      'chemical_base, trunk_line, group_name, active',
    )
    .eq('site_id', siteId)
    .order('sort_order', { ascending: true });

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    id: r.id as string,
    minCapacity: r.min_capacity as number | null,
    maxCapacity: r.max_capacity as number | null,
    maxBatchesPerDay: (r.max_batches_per_day as number) ?? 1,
    chemicalBase: r.chemical_base as string | null,
    trunkLine: r.trunk_line as string | null,
    groupName: r.group_name as string | null,
    active: r.active as boolean,
  }));
}

async function fetchColourGroups(
  supabase: SupabaseClient,
  siteId: string,
): Promise<ColourGroup[]> {
  const { data } = await supabase
    .from('colour_groups')
    .select('id, code, name, sort_order')
    .eq('site_id', siteId)
    .eq('active', true)
    .order('sort_order', { ascending: true });

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((g) => ({
    id: g.id as string,
    code: g.code as string,
    name: g.name as string,
    sortOrder: g.sort_order as number,
  }));
}

async function fetchColourTransitions(
  supabase: SupabaseClient,
  siteId: string,
): Promise<ColourTransition[]> {
  const { data } = await supabase
    .from('colour_transitions')
    .select('from_group_id, to_group_id, allowed, requires_washout, washout_minutes')
    .eq('site_id', siteId);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((t) => ({
    fromGroupId: t.from_group_id as string,
    toGroupId: t.to_group_id as string,
    allowed: t.allowed as boolean,
    requiresWashout: t.requires_washout as boolean,
    washoutMinutes: (t.washout_minutes as number) ?? 0,
  }));
}

async function fetchResourceBlocks(
  supabase: SupabaseClient,
  siteId: string,
): Promise<ScoringResourceBlock[]> {
  const { data } = await supabase
    .from('resource_blocks')
    .select('resource_id, start_date, end_date')
    .eq('site_id', siteId);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((b) => ({
    resourceId: b.resource_id as string,
    startDate: b.start_date as string,
    endDate: b.end_date as string,
  }));
}

async function fetchSubstitutionRules(
  supabase: SupabaseClient,
  siteId: string,
): Promise<ScoringSubstitutionRule[]> {
  const { data } = await supabase
    .from('substitution_rules')
    .select('source_resource_id, target_resource_id, conditions, enabled')
    .eq('site_id', siteId)
    .eq('enabled', true);

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return rows.map((r) => ({
    sourceResourceId: r.source_resource_id as string | null,
    targetResourceId: r.target_resource_id as string | null,
    conditions: r.conditions as ScoringSubstitutionRule['conditions'],
    enabled: r.enabled as boolean,
  }));
}

async function fetchScheduleRules(
  supabase: SupabaseClient,
  siteId: string,
): Promise<{ enabled: boolean; conditions: Record<string, unknown> | null; actions: Record<string, unknown> | null }[]> {
  const { data } = await supabase
    .from('schedule_rules')
    .select('enabled, conditions, actions')
    .eq('site_id', siteId)
    .eq('enabled', true);

  return (data ?? []) as unknown as { enabled: boolean; conditions: Record<string, unknown> | null; actions: Record<string, unknown> | null }[];
}

/** Fetch all scoring context data in parallel */
async function fetchScoringContext(
  supabase: SupabaseClient,
  siteId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<{
  batches: ScoringBatch[];
  resources: ScoringResource[];
  colourGroups: ColourGroup[];
  colourTransitions: ColourTransition[];
  resourceBlocks: ScoringResourceBlock[];
  substitutionRules: ScoringSubstitutionRule[];
  weights: ScoringWeights;
  resourceTrunkLines: Record<string, string | null>;
}> {
  const [batches, resources, colourGroups, colourTransitions, resourceBlocks, substitutionRules, scheduleRules] =
    await Promise.all([
      fetchBatches(supabase, siteId, dateFrom, dateTo),
      fetchResources(supabase, siteId),
      fetchColourGroups(supabase, siteId),
      fetchColourTransitions(supabase, siteId),
      fetchResourceBlocks(supabase, siteId),
      fetchSubstitutionRules(supabase, siteId),
      fetchScheduleRules(supabase, siteId),
    ]);

  const weights = extractWeights(scheduleRules);
  const resourceTrunkLines: Record<string, string | null> = {};
  for (const r of resources) {
    resourceTrunkLines[r.id] = r.trunkLine;
  }

  return { batches, resources, colourGroups, colourTransitions, resourceBlocks, substitutionRules, weights, resourceTrunkLines };
}

/** Extra fields exposed alongside ScoringBatch for ranking/chat use */
export interface EnrichedBatch extends ScoringBatch {
  poDate: string | null;
  stockCover: number | null;
  materialDescription: string | null;
}

function mapDbBatch(row: Record<string, unknown>): ScoringBatch {
  const rmAvailable = (row.rm_available as boolean) ?? true;
  const packagingAvailable = (row.packaging_available as boolean) ?? true;
  const poDate = (row.po_date as string | null) ?? null;

  // Use po_date as the expected delivery date for materials/packaging when the
  // batch is flagged as unavailable.  This is the best available date signal
  // in the current schema and allows scoring to anchor recommendations to
  // "after expected delivery".
  const rmAvailableDate = !rmAvailable && poDate ? poDate : null;
  const packagingAvailableDate = !packagingAvailable && poDate ? poDate : null;

  return {
    id: row.id as string,
    batchVolume: row.batch_volume as number | null,
    sapColorGroup: row.sap_color_group as string | null,
    chemicalBase: null, // batches don't have chemical_base column; checked via resource
    status: (row.status as string) ?? 'Planned',
    rmAvailable,
    packagingAvailable,
    rmAvailableDate,
    packagingAvailableDate,
    planResourceId: row.plan_resource_id as string | null,
    planDate: row.plan_date as string | null,
    bulkCode: row.bulk_code as string | null,
  };
}

function mapDbBatchEnriched(row: Record<string, unknown>): EnrichedBatch {
  const base = mapDbBatch(row);
  return {
    ...base,
    poDate: (row.po_date as string | null) ?? null,
    stockCover: (row.stock_cover as number | null) ?? null,
    materialDescription: (row.material_description as string | null) ?? null,
  };
}

function groupBatchesByResourceDate(batches: ScoringBatch[]): Map<string, ScoringBatch[]> {
  const map = new Map<string, ScoringBatch[]>();
  for (const batch of batches) {
    if (batch.planResourceId == null || batch.planDate == null) continue;
    const key = `${batch.planResourceId}|${batch.planDate}`;
    const group = map.get(key);
    if (group) group.push(batch);
    else map.set(key, [batch]);
  }
  return map;
}

function buildPlacementContext(
  targetResourceId: string,
  targetDate: string,
  ctx: Awaited<ReturnType<typeof fetchScoringContext>>,
): ScoringContext {
  const batchesByRD = groupBatchesByResourceDate(ctx.batches);
  const dailyBatches = batchesByRD.get(`${targetResourceId}|${targetDate}`) ?? [];
  const allDailyBatches = ctx.batches.filter((b) => b.planDate === targetDate);
  const activeResourceCount = ctx.resources.filter((r) => r.active).length;

  return {
    dailyBatches,
    allDailyBatches,
    resourceBlocks: ctx.resourceBlocks,
    colourTransitions: ctx.colourTransitions,
    colourGroups: ctx.colourGroups,
    substitutionRules: ctx.substitutionRules,
    weights: ctx.weights,
    activeResourceCount,
    resourceTrunkLines: ctx.resourceTrunkLines,
  };
}

// ─── Tool Handlers ──────────────────────────────────────────────────────────

type ToolHandler = (
  args: Record<string, unknown>,
  supabase: SupabaseClient,
  siteId: string,
) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;

const handlers: Record<string, ToolHandler> = {
  score_placement: async (args, supabase, siteId) => {
    const batchId = args.batch_id as string | undefined;
    if (!batchId) return textResult('Error: batch_id is required.');

    const batch = await fetchBatchById(supabase, siteId, batchId);
    if (!batch) return textResult(`Error: batch ${batchId} not found.`);

    const ctx = await fetchScoringContext(supabase, siteId);
    const scorer = new PlacementScorer(ctx.weights);

    const targetDate = (args.target_date as string) ?? batch.planDate ?? new Date().toISOString().slice(0, 10);
    const specificResourceId = args.resource_id as string | undefined;

    if (specificResourceId) {
      const resource = ctx.resources.find((r) => r.id === specificResourceId);
      if (!resource) return textResult(`Error: resource ${specificResourceId} not found.`);

      const placementCtx = buildPlacementContext(resource.id, targetDate, ctx);
      const result = scorer.score(batch, resource, targetDate, placementCtx);

      return textResult(JSON.stringify({ batch_id: batchId, resource_id: resource.id, target_date: targetDate, ...result }, null, 2));
    }

    // Score all active resources
    const activeResources = ctx.resources.filter((r) => r.active);
    const results = activeResources.map((resource) => {
      const placementCtx = buildPlacementContext(resource.id, targetDate, ctx);
      const result = scorer.score(batch, resource, targetDate, placementCtx);
      return { resource_id: resource.id, ...result };
    });

    results.sort((a, b) => b.score - a.score);

    return textResult(JSON.stringify({ batch_id: batchId, target_date: targetDate, placements: results }, null, 2));
  },

  score_health: async (args, supabase, siteId) => {
    const dateFrom = args.date_from as string | undefined;
    const dateTo = args.date_to as string | undefined;

    const ctx = await fetchScoringContext(supabase, siteId, dateFrom, dateTo);
    const placementScorer = new PlacementScorer(ctx.weights);
    const healthScorer = new HealthScorer(placementScorer);

    const healthCtx: HealthScoringContext = {
      batches: ctx.batches,
      resources: ctx.resources,
      resourceBlocks: ctx.resourceBlocks,
      colourTransitions: ctx.colourTransitions,
      colourGroups: ctx.colourGroups,
      substitutionRules: ctx.substitutionRules,
      resourceTrunkLines: ctx.resourceTrunkLines,
    };

    const report = healthScorer.evaluate(healthCtx);

    return textResult(JSON.stringify(report, null, 2));
  },

  find_best_move: async (args, supabase, siteId) => {
    const batchId = args.batch_id as string | undefined;
    if (!batchId) return textResult('Error: batch_id is required.');

    const batch = await fetchBatchById(supabase, siteId, batchId);
    if (!batch) return textResult(`Error: batch ${batchId} not found.`);

    const ctx = await fetchScoringContext(supabase, siteId);
    const scorer = new PlacementScorer(ctx.weights);

    const targetDate = (args.target_date as string) ?? batch.planDate ?? new Date().toISOString().slice(0, 10);
    const excludeCurrent = args.exclude_current === true;

    const candidates = ctx.resources.filter((r) => {
      if (!r.active) return false;
      if (excludeCurrent && batch.planResourceId && r.id === batch.planResourceId) return false;
      return true;
    });

    const scored = candidates.map((resource) => {
      const placementCtx = buildPlacementContext(resource.id, targetDate, ctx);
      const result = scorer.score(batch, resource, targetDate, placementCtx);
      return { resource_id: resource.id, ...result };
    });

    // Sort by score descending, take top 5 feasible
    scored.sort((a, b) => b.score - a.score);
    const top5 = scored.filter((s) => s.feasible).slice(0, 5);

    return textResult(JSON.stringify({
      batch_id: batchId,
      target_date: targetDate,
      top_options: top5,
      total_feasible: scored.filter((s) => s.feasible).length,
      total_blocked: scored.filter((s) => !s.feasible).length,
    }, null, 2));
  },

  simulate_move: async (args, supabase, siteId) => {
    const batchId = args.batch_id as string | undefined;
    const targetResourceId = args.target_resource_id as string | undefined;
    if (!batchId) return textResult('Error: batch_id is required.');
    if (!targetResourceId) return textResult('Error: target_resource_id is required.');

    const batch = await fetchBatchById(supabase, siteId, batchId);
    if (!batch) return textResult(`Error: batch ${batchId} not found.`);

    const ctx = await fetchScoringContext(supabase, siteId);
    const targetResource = ctx.resources.find((r) => r.id === targetResourceId);
    if (!targetResource) return textResult(`Error: resource ${targetResourceId} not found.`);

    const targetDate = (args.target_date as string) ?? batch.planDate ?? new Date().toISOString().slice(0, 10);
    const placementScorer = new PlacementScorer(ctx.weights);
    const healthScorer = new HealthScorer(placementScorer);

    // Health score BEFORE the move
    const beforeCtx: HealthScoringContext = {
      batches: ctx.batches,
      resources: ctx.resources,
      resourceBlocks: ctx.resourceBlocks,
      colourTransitions: ctx.colourTransitions,
      colourGroups: ctx.colourGroups,
      substitutionRules: ctx.substitutionRules,
      resourceTrunkLines: ctx.resourceTrunkLines,
    };
    const beforeReport = healthScorer.evaluate(beforeCtx);

    // Health score AFTER the move (simulate by cloning batch list with modified assignment)
    const afterBatches = ctx.batches.map((b) =>
      b.id === batchId
        ? { ...b, planResourceId: targetResourceId, planDate: targetDate }
        : b,
    );
    const afterCtx: HealthScoringContext = {
      ...beforeCtx,
      batches: afterBatches,
    };
    const afterReport = healthScorer.evaluate(afterCtx);

    // Compute placement score for the specific move
    const placementCtx = buildPlacementContext(targetResourceId, targetDate, { ...ctx, batches: afterBatches });
    const placementResult = placementScorer.score(batch, targetResource, targetDate, placementCtx);

    // Diff issues
    const beforeIssueKeys = new Set(beforeReport.issues.map((i) => `${i.batchId}|${i.type}`));
    const afterIssueKeys = new Set(afterReport.issues.map((i) => `${i.batchId}|${i.type}`));
    const resolvedIssues = beforeReport.issues.filter((i) => !afterIssueKeys.has(`${i.batchId}|${i.type}`));
    const newIssues = afterReport.issues.filter((i) => !beforeIssueKeys.has(`${i.batchId}|${i.type}`));

    return textResult(JSON.stringify({
      batch_id: batchId,
      move: {
        from_resource_id: batch.planResourceId,
        from_date: batch.planDate,
        to_resource_id: targetResourceId,
        to_date: targetDate,
      },
      placement_score: placementResult,
      health_before: beforeReport.score,
      health_after: afterReport.score,
      health_delta: afterReport.score - beforeReport.score,
      issues_resolved: resolvedIssues.length,
      issues_introduced: newIssues.length,
      resolved_details: resolvedIssues,
      introduced_details: newIssues,
    }, null, 2));
  },

  rank_wom_batches: async (args, supabase, siteId) => {
    const includeWom = args.include_wom !== false;
    const includeWop = args.include_wop !== false;
    const limit = Math.min(Number(args.limit) || 20, 50);
    const topOptionsCount = Math.min(Number(args.top_options) || 3, 5);
    const dateFrom = args.date_from as string | undefined;
    const dateTo = args.date_to as string | undefined;

    // Fetch enriched WOM/WOP batches directly
    let query = supabase
      .from('batches')
      .select(
        'id, batch_volume, sap_color_group, status, ' +
        'rm_available, packaging_available, plan_resource_id, plan_date, bulk_code, ' +
        'po_date, stock_cover, material_description, sap_order',
      )
      .eq('site_id', siteId)
      .order('plan_date', { ascending: true })
      .limit(500);

    if (dateFrom) query = query.gte('plan_date', dateFrom);
    if (dateTo) query = query.lte('plan_date', dateTo);

    // Build an OR filter for WOM and/or WOP
    const orParts: string[] = [];
    if (includeWom) orParts.push('rm_available.eq.false');
    if (includeWop) orParts.push('packaging_available.eq.false');

    if (orParts.length === 0) {
      return textResult('Error: at least one of include_wom or include_wop must be true.');
    }
    query = query.or(orParts.join(','));

    const { data: rawBatches, error } = await query;
    if (error) return textResult(`Error fetching WOM/WOP batches: ${error.message}`);
    if (!rawBatches || rawBatches.length === 0) {
      return textResult(JSON.stringify({ ranked_batches: [], total: 0, summary: 'No WOM/WOP batches found.' }, null, 2));
    }

    // Fetch full scoring context for placement scoring
    const ctx = await fetchScoringContext(supabase, siteId, dateFrom, dateTo);
    const scorer = new PlacementScorer(ctx.weights);
    const today = new Date().toISOString().slice(0, 10);

    // Rank each WOM/WOP batch by urgency
    const ranked = (rawBatches as unknown as Record<string, unknown>[]).map((row) => {
      const enriched = mapDbBatchEnriched(row);
      const sapOrder = row.sap_order as string | null;

      // Compute urgency score:
      // - Earlier plan_date → more urgent (time pressure)
      // - Lower stock_cover → more urgent (customer impact)
      // - Both WOM+WOP → more urgent than just one
      let urgencyScore = 100;

      // Time pressure: days until plan_date from today
      if (enriched.planDate) {
        const daysUntil = Math.floor(
          (new Date(enriched.planDate).getTime() - new Date(today).getTime()) / 86400000,
        );
        if (daysUntil <= 0) urgencyScore += 30; // overdue
        else if (daysUntil <= 3) urgencyScore += 20;
        else if (daysUntil <= 7) urgencyScore += 10;
        else urgencyScore -= Math.min(daysUntil, 30);
      }

      // Stock cover pressure
      if (enriched.stockCover != null) {
        if (enriched.stockCover <= 0) urgencyScore += 25;
        else if (enriched.stockCover <= 7) urgencyScore += 15;
        else if (enriched.stockCover <= 14) urgencyScore += 5;
      }

      // Both WOM+WOP is worse
      const isWom = !enriched.rmAvailable;
      const isWop = !enriched.packagingAvailable;
      if (isWom && isWop) urgencyScore += 10;

      // Determine the earliest date after which we can reschedule
      // (after PO expected delivery for the blocking material)
      const blockingDates: string[] = [];
      if (isWom && enriched.rmAvailableDate) blockingDates.push(enriched.rmAvailableDate);
      if (isWop && enriched.packagingAvailableDate) blockingDates.push(enriched.packagingAvailableDate);

      // Use the latest blocking date (both must be resolved)
      const earliestRescheduleDate = blockingDates.length > 0
        ? blockingDates.sort().pop()!
        : null;

      // Score placement options on/after the earliest reschedule date
      const targetDate = earliestRescheduleDate ?? enriched.planDate ?? today;
      const activeResources = ctx.resources.filter((r) => r.active);

      const options = activeResources.map((resource) => {
        const placementCtx = buildPlacementContext(resource.id, targetDate, ctx);
        const result = scorer.score(enriched, resource, targetDate, placementCtx);
        return { resource_id: resource.id, target_date: targetDate, ...result };
      });

      options.sort((a, b) => b.score - a.score);
      const topFeasible = options.filter((o) => o.feasible).slice(0, topOptionsCount);

      return {
        batch_id: enriched.id,
        sap_order: sapOrder,
        material_description: enriched.materialDescription,
        plan_date: enriched.planDate,
        plan_resource_id: enriched.planResourceId,
        is_wom: isWom,
        is_wop: isWop,
        po_date: enriched.poDate,
        stock_cover: enriched.stockCover,
        urgency_score: urgencyScore,
        earliest_reschedule_date: earliestRescheduleDate,
        recommended_options: topFeasible.map((o) => ({
          resource_id: o.resource_id,
          target_date: o.target_date,
          placement_score: o.score,
          feasible: o.feasible,
          factors: o.factors,
        })),
        total_feasible_options: options.filter((o) => o.feasible).length,
      };
    });

    // Sort by urgency descending
    ranked.sort((a, b) => b.urgency_score - a.urgency_score);
    const topRanked = ranked.slice(0, limit);

    const womCount = ranked.filter((r) => r.is_wom).length;
    const wopCount = ranked.filter((r) => r.is_wop).length;
    const bothCount = ranked.filter((r) => r.is_wom && r.is_wop).length;

    return textResult(JSON.stringify({
      ranked_batches: topRanked,
      total: ranked.length,
      summary: `Found ${ranked.length} material-blocked batches: ${womCount} WOM, ${wopCount} WOP (${bothCount} both). Ranked by urgency (plan date proximity + stock cover).`,
      wom_count: womCount,
      wop_count: wopCount,
      both_count: bothCount,
    }, null, 2));
  },

  query_colour_transitions: async (args, supabase, siteId) => {
    const limit = Math.min(Number(args.limit) || 200, 500);

    // Fetch groups and transitions
    const [groups, transitions] = await Promise.all([
      fetchColourGroups(supabase, siteId),
      fetchColourTransitions(supabase, siteId),
    ]);

    const groupMap = new Map(groups.map((g) => [g.id, g]));

    // Build enriched transition list
    let results = transitions.map((t) => {
      const fromGroup = groupMap.get(t.fromGroupId);
      const toGroup = groupMap.get(t.toGroupId);
      return {
        from_group_id: t.fromGroupId,
        from_group_code: fromGroup?.code ?? 'unknown',
        from_group_name: fromGroup?.name ?? 'unknown',
        to_group_id: t.toGroupId,
        to_group_code: toGroup?.code ?? 'unknown',
        to_group_name: toGroup?.name ?? 'unknown',
        allowed: t.allowed,
        requires_washout: t.requiresWashout,
        washout_minutes: t.washoutMinutes,
      };
    });

    // Apply filters
    if (typeof args.from_group_code === 'string') {
      const code = args.from_group_code;
      results = results.filter(
        (r) => r.from_group_code.toLowerCase() === code.toLowerCase() || r.from_group_name.toLowerCase() === code.toLowerCase(),
      );
    }
    if (typeof args.to_group_code === 'string') {
      const code = args.to_group_code;
      results = results.filter(
        (r) => r.to_group_code.toLowerCase() === code.toLowerCase() || r.to_group_name.toLowerCase() === code.toLowerCase(),
      );
    }
    if (args.allowed_only === true) {
      results = results.filter((r) => r.allowed);
    }

    return textResult(JSON.stringify({
      colour_groups: groups.map((g) => ({ id: g.id, code: g.code, name: g.name, sort_order: g.sortOrder })),
      transitions: results.slice(0, limit),
      total: results.length,
    }, null, 2));
  },
};

// ─── Handler Dispatch ───────────────────────────────────────────────────────

export async function handleScoringTool(
  toolName: string,
  args: Record<string, unknown>,
  supabase: SupabaseClient,
  siteId: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const handler = handlers[toolName];
  if (!handler) {
    return textResult(`Unknown scoring tool: ${toolName}`);
  }
  return handler(args, supabase, siteId);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function textResult(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

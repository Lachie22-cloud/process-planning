/**
 * Database-driven system prompt assembler.
 *
 * Queries ai_prompt_sections for the given site and context,
 * substitutes template variables, and returns a complete system prompt.
 * Includes a 60-second in-memory cache per siteId+context.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { scheduleDbTools } from '../mcp/tools/schedule-db.js';
import { wikiTools } from '../mcp/tools/wiki-search.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AssemblePromptOptions {
  supabase: SupabaseClient;
  siteId: string;
  siteName?: string;
  userName?: string;
  context: 'chat' | 'scan';
}

interface PromptSectionRow {
  id: string;
  section_key: string;
  label: string;
  content: string;
  context: 'chat' | 'scan' | 'both';
  sort_order: number;
  enabled: boolean;
}

// ─── Cache ──────────────────────────────────────────────────────────────────

interface CacheEntry {
  sections: PromptSectionRow[];
  fetchedAt: number;
}

const CACHE_TTL_MS = 60_000; // 60 seconds
const sectionCache = new Map<string, CacheEntry>();

function cacheKey(siteId: string, context: string): string {
  return `${siteId}:${context}`;
}

/** Clear cached sections for a site (called after admin edits). */
export function invalidatePromptCache(siteId: string): void {
  for (const key of sectionCache.keys()) {
    if (key.startsWith(siteId)) {
      sectionCache.delete(key);
    }
  }
}

// ─── Tool List Generator ────────────────────────────────────────────────────

function generateToolList(): string {
  const lines: string[] = [
    'You have access to tools that let you query the production database:',
  ];

  for (const tool of scheduleDbTools) {
    const shortDesc = tool.description.split('.')[0];
    lines.push(`- ${tool.name}: ${shortDesc}`);
  }

  lines.push('');
  lines.push('You also have access to a knowledge base (wiki):');

  for (const tool of wikiTools) {
    const shortDesc = tool.description.split('.')[0];
    lines.push(`- ${tool.name}: ${shortDesc}`);
  }

  return lines.join('\n');
}

// ─── Variable Substitution ──────────────────────────────────────────────────

function substituteVariables(
  content: string,
  vars: Record<string, string>,
): string {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    return vars[key] ?? match;
  });
}

// ─── Fallback Prompt ────────────────────────────────────────────────────────

function getFallbackPrompt(siteId: string, siteName?: string): string {
  const name = siteName ?? 'Unknown Site';
  return [
    `You are the ${name} Planning Assistant, an AI agent for a paint manufacturing facility.`,
    'Your role is to analyse production schedules, suggest optimisations, and help with resource planning.',
    '',
    generateToolList(),
    '',
    'Be concise and helpful. Use British English spelling.',
    '',
    `Site: ${name} (ID: ${siteId})`,
    `Current date: ${new Date().toISOString().split('T')[0]}`,
  ].join('\n');
}

// ─── Main Assembler ─────────────────────────────────────────────────────────

export async function assembleSystemPrompt(
  opts: AssemblePromptOptions,
): Promise<string> {
  const { supabase, siteId, context } = opts;
  const siteName = opts.siteName ?? 'Unknown Site';
  const userName = opts.userName ?? 'a user';
  const key = cacheKey(siteId, context);

  // Check cache
  let sections: PromptSectionRow[];
  const cached = sectionCache.get(key);

  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    sections = cached.sections;
  } else {
    // Query database for enabled sections matching context
    const { data, error } = await supabase
      .from('ai_prompt_sections')
      .select('id, section_key, label, content, context, sort_order, enabled')
      .eq('site_id', siteId)
      .eq('enabled', true)
      .or(`context.eq.${context},context.eq.both`)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('[prompt-assembler] DB query error:', error.message);
      return getFallbackPrompt(siteId, siteName);
    }

    sections = (data ?? []) as PromptSectionRow[];

    // Cache the result
    sectionCache.set(key, { sections, fetchedAt: Date.now() });
  }

  // Fallback if no sections found
  if (sections.length === 0) {
    return getFallbackPrompt(siteId, siteName);
  }

  // Build template variable map
  const vars: Record<string, string> = {
    siteName,
    siteId,
    userName,
    currentDate: new Date().toISOString().split('T')[0],
    toolList: generateToolList(),
  };

  // Assemble sections
  const parts: string[] = [];

  for (const section of sections) {
    if (!section.content.trim()) continue;
    const resolved = substituteVariables(section.content, vars);
    parts.push(resolved);
  }

  // Append context footer (always code-generated)
  parts.push('');
  parts.push(`You are speaking with ${userName}.`);
  parts.push(`Site: ${siteName} (ID: ${siteId})`);
  parts.push(`Current date: ${vars.currentDate}`);

  return parts.join('\n');
}

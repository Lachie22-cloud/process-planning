/**
 * Wiki search MCP tools.
 *
 * Provides full-text search and article retrieval from the wiki_articles table.
 * Used as the RAG knowledge source for the AI agent.
 * All queries are scoped to the configured site_id.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ToolDefinition } from './schedule-db.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const wikiTools: ToolDefinition[] = [
  {
    name: 'search_wiki',
    description:
      'Full-text search across wiki knowledge base articles. Returns ' +
      'matching articles ranked by relevance. Use this to find site-specific ' +
      'procedures, policies, and reference information.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query text',
        },
        category: {
          type: 'string',
          description: 'Optional category filter',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default: 10, max: 50)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_wiki_article',
    description:
      'Get the full content of a specific wiki article by ID. ' +
      'Use after search_wiki to read full article content.',
    inputSchema: {
      type: 'object',
      properties: {
        article_id: {
          type: 'string',
          description: 'UUID of the wiki article',
        },
      },
      required: ['article_id'],
    },
  },
];

// ─── Tool Handlers ──────────────────────────────────────────────────────────

type ToolHandler = (
  args: Record<string, unknown>,
  supabase: SupabaseClient,
  siteId: string,
) => Promise<{ content: Array<{ type: 'text'; text: string }> }>;

const handlers: Record<string, ToolHandler> = {
  search_wiki: async (args, supabase, siteId) => {
    const query = args.query as string | undefined;
    if (!query) {
      return textResult('Error: query parameter is required.');
    }

    const limit = Math.min(Number(args.limit) || 10, 50);

    // Use the search_wiki RPC for full-text search
    const { data, error } = await supabase.rpc('search_wiki', {
      p_site_id: siteId,
      p_query: query,
      p_limit: limit,
    });

    if (error) {
      // Fallback to ILIKE search if RPC not available
      let fallbackQuery = supabase
        .from('wiki_articles')
        .select('id, title, content, category')
        .eq('site_id', siteId)
        .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
        .order('sort_order', { ascending: true })
        .limit(limit);

      if (typeof args.category === 'string') {
        fallbackQuery = fallbackQuery.eq('category', args.category);
      }

      const { data: fallbackData, error: fallbackError } = await fallbackQuery;

      if (fallbackError) {
        return textResult(`Error searching wiki: ${fallbackError.message}`);
      }

      // Truncate content for search results
      const results = (fallbackData ?? []).map((article: Record<string, unknown>) => ({
        id: article.id,
        title: article.title,
        category: article.category,
        snippet: truncate(article.content as string, 200),
      }));

      return textResult(
        results.length > 0
          ? JSON.stringify(results, null, 2)
          : 'No wiki articles found matching your query.',
      );
    }

    // Format RPC results
    const results = (data ?? []).map((row: Record<string, unknown>) => ({
      id: row.id,
      title: row.title,
      category: row.category,
      snippet: truncate(row.content as string, 200),
      relevance: row.rank,
    }));

    return textResult(
      results.length > 0
        ? JSON.stringify(results, null, 2)
        : 'No wiki articles found matching your query.',
    );
  },

  get_wiki_article: async (args, supabase, siteId) => {
    const articleId = args.article_id as string | undefined;
    if (!articleId) {
      return textResult('Error: article_id parameter is required.');
    }

    const { data, error } = await supabase
      .from('wiki_articles')
      .select('id, title, content, category, created_at, updated_at')
      .eq('id', articleId)
      .eq('site_id', siteId)
      .single();

    if (error) {
      return textResult(
        error.code === 'PGRST116'
          ? 'Article not found or not accessible for this site.'
          : `Error fetching article: ${error.message}`,
      );
    }

    return textResult(JSON.stringify(data, null, 2));
  },
};

// ─── Handler Dispatch ───────────────────────────────────────────────────────

/**
 * Execute a wiki tool by name.
 */
export async function handleWikiTool(
  toolName: string,
  args: Record<string, unknown>,
  supabase: SupabaseClient,
  siteId: string,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const handler = handlers[toolName];
  if (!handler) {
    return textResult(`Unknown wiki tool: ${toolName}`);
  }
  return handler(args, supabase, siteId);
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function textResult(text: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text }] };
}

function truncate(text: string, maxLen: number): string {
  if (!text || text.length <= maxLen) return text ?? '';
  return text.slice(0, maxLen) + '...';
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase/client";
import { useCurrentSite } from "./use-current-site";
import type { DatabaseRow } from "@/types/database";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface WikiArticle {
  id: string;
  siteId: string;
  title: string;
  content: string;
  category: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  updatedBy: string | null;
}

function mapWikiArticle(row: DatabaseRow["wiki_articles"]): WikiArticle {
  return {
    id: row.id,
    siteId: row.site_id,
    title: row.title,
    content: row.content,
    category: row.category,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
  };
}

/* ------------------------------------------------------------------ */
/*  Queries                                                            */
/* ------------------------------------------------------------------ */

export function useWikiArticles() {
  const { site } = useCurrentSite();

  return useQuery<WikiArticle[]>({
    queryKey: ["wiki_articles", site?.id],
    queryFn: async () => {
      if (!site) return [];

      const { data, error } = await supabase
        .from("wiki_articles")
        .select("*")
        .eq("site_id", site.id)
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true });

      if (error) throw error;
      return (data as DatabaseRow["wiki_articles"][]).map(mapWikiArticle);
    },
    enabled: !!site,
  });
}

/* ------------------------------------------------------------------ */
/*  Mutations                                                          */
/* ------------------------------------------------------------------ */

interface WikiArticleInput {
  title: string;
  content: string;
  category: string | null;
  sortOrder?: number;
}

export function useCreateWikiArticle() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: WikiArticleInput) => {
      if (!site) throw new Error("No site selected");

      const { data, error } = await supabase
        .from("wiki_articles")
        .insert({
          site_id: site.id,
          title: input.title.trim(),
          content: input.content,
          category: input.category?.trim() || null,
          sort_order: input.sortOrder ?? 0,
          created_by: user?.id ?? null,
          updated_by: user?.id ?? null,
        } as never)
        .select("*")
        .single();

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "wiki_article.created",
        details: { title: input.title },
        performed_by: user?.email ?? null,
      } as never);

      return mapWikiArticle(data as DatabaseRow["wiki_articles"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wiki_articles", site?.id] });
      toast.success("Article created");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to create article");
    },
  });
}

export function useUpdateWikiArticle() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: WikiArticleInput & { id: string }) => {
      if (!site) throw new Error("No site selected");

      const { data, error } = await supabase
        .from("wiki_articles")
        .update({
          title: input.title.trim(),
          content: input.content,
          category: input.category?.trim() || null,
          sort_order: input.sortOrder ?? 0,
          updated_by: user?.id ?? null,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", id)
        .eq("site_id", site.id)
        .select("*")
        .single();

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "wiki_article.updated",
        details: { articleId: id, title: input.title },
        performed_by: user?.email ?? null,
      } as never);

      return mapWikiArticle(data as DatabaseRow["wiki_articles"]);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wiki_articles", site?.id] });
      toast.success("Article updated");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to update article");
    },
  });
}

export function useDeleteWikiArticle() {
  const { site, user } = useCurrentSite();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (articleId: string) => {
      if (!site) throw new Error("No site selected");

      const { error } = await supabase
        .from("wiki_articles")
        .delete()
        .eq("id", articleId)
        .eq("site_id", site.id);

      if (error) throw error;

      await supabase.from("audit_log").insert({
        site_id: site.id,
        action: "wiki_article.deleted",
        details: { articleId },
        performed_by: user?.email ?? null,
      } as never);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wiki_articles", site?.id] });
      toast.success("Article deleted");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Failed to delete article");
    },
  });
}

import { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePermissions } from "@/hooks/use-permissions";
import {
  useWikiArticles,
  useCreateWikiArticle,
  useUpdateWikiArticle,
  useDeleteWikiArticle,
  type WikiArticle,
} from "@/hooks/use-wiki";
import {
  Plus,
  Pencil,
  Trash2,
  BookOpen,
  RefreshCw,
} from "lucide-react";
import { Navigate } from "react-router-dom";

interface ArticleFormState {
  title: string;
  content: string;
  category: string;
  sortOrder: number;
}

const EMPTY_FORM: ArticleFormState = {
  title: "",
  content: "",
  category: "",
  sortOrder: 0,
};

export function AdminWikiPage() {
  const { hasPermission } = usePermissions();
  const { data: articles, isLoading } = useWikiArticles();
  const createArticle = useCreateWikiArticle();
  const updateArticle = useUpdateWikiArticle();
  const deleteArticle = useDeleteWikiArticle();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ArticleFormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<WikiArticle | null>(null);
  const [filterCategory, setFilterCategory] = useState<string>("");

  if (!hasPermission("admin.settings")) {
    return <Navigate to="/admin" replace />;
  }

  const categories = Array.from(
    new Set((articles ?? []).map((a) => a.category).filter(Boolean) as string[]),
  ).sort();

  const filtered = filterCategory
    ? (articles ?? []).filter((a) => a.category === filterCategory)
    : (articles ?? []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (article: WikiArticle) => {
    setEditingId(article.id);
    setForm({
      title: article.title,
      content: article.content,
      category: article.category ?? "",
      sortOrder: article.sortOrder,
    });
    setFormOpen(true);
  };

  const handleSubmit = () => {
    if (!form.title.trim()) return;

    const payload = {
      title: form.title,
      content: form.content,
      category: form.category || null,
      sortOrder: form.sortOrder,
    };

    if (editingId) {
      updateArticle.mutate(
        { id: editingId, ...payload },
        { onSuccess: () => setFormOpen(false) },
      );
    } else {
      createArticle.mutate(payload, {
        onSuccess: () => setFormOpen(false),
      });
    }
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteArticle.mutate(deleteTarget.id, {
      onSuccess: () => setDeleteTarget(null),
    });
  };

  const isMutating =
    createArticle.isPending || updateArticle.isPending;

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Knowledge Base"
        description="Manage wiki articles that provide context to the AI agent"
        actions={
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" />
            New Article
          </Button>
        }
      />

      {/* Category filter */}
      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={filterCategory === "" ? "default" : "outline"}
            className="cursor-pointer"
            onClick={() => setFilterCategory("")}
          >
            All ({(articles ?? []).length})
          </Badge>
          {categories.map((cat) => (
            <Badge
              key={cat}
              variant={filterCategory === cat ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setFilterCategory(cat)}
            >
              {cat} ({(articles ?? []).filter((a) => a.category === cat).length})
            </Badge>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <BookOpen className="h-12 w-12 text-muted-foreground/50" />
            <p className="mt-4 text-sm text-muted-foreground">
              {filterCategory
                ? "No articles in this category."
                : "No wiki articles yet. Create one to get started."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Articles</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="hidden sm:table-cell">Updated</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((article) => (
                  <TableRow key={article.id}>
                    <TableCell>
                      <div>
                        <span className="font-medium">{article.title}</span>
                        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                          {article.content.slice(0, 120)}
                          {article.content.length > 120 ? "..." : ""}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>
                      {article.category ? (
                        <Badge variant="outline">{article.category}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-sm text-muted-foreground sm:table-cell">
                      {new Date(article.updatedAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => openEdit(article)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setDeleteTarget(article)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Edit Article" : "New Article"}
            </DialogTitle>
            <DialogDescription>
              {editingId
                ? "Update the article content and metadata."
                : "Create a new knowledge base article for the AI agent."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Title</Label>
                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Article title"
                />
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2">
                  <Label>Category</Label>
                  <Input
                    value={form.category}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, category: e.target.value }))
                    }
                    placeholder="e.g. Processes"
                    list="wiki-categories"
                  />
                  <datalist id="wiki-categories">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label>Sort Order</Label>
                  <Input
                    type="number"
                    value={form.sortOrder}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        sortOrder: parseInt(e.target.value, 10) || 0,
                      }))
                    }
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Content</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
                placeholder="Article content (plain text or markdown)"
                rows={12}
                className="font-mono text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={!form.title.trim() || isMutating}
            >
              {isMutating && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title="Delete Article"
        description={`Are you sure you want to delete "${deleteTarget?.title}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}

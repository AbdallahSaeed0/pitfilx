import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createList, deleteList, getLists } from "../api/lists";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Spinner } from "../components/ui/Spinner";

type ListRow = {
  id: number;
  name: string;
  itemCount?: number;
  isDefault?: boolean;
};

export function MyListsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["lists"], queryFn: getLists });
  const [creating, setCreating] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [listToDelete, setListToDelete] = useState<ListRow | null>(null);

  const lists = (data ?? []) as ListRow[];

  const handleCreate = async () => {
    const name = newListName.trim();
    if (!name) return;
    await createList({ name });
    setNewListName("");
    setCreating(false);
    void qc.invalidateQueries({ queryKey: ["lists"] });
  };

  const handleDelete = (e: React.MouseEvent, list: ListRow) => {
    e.stopPropagation();
    if (list.isDefault) return;
    setListToDelete(list);
  };

  const confirmDeleteList = async () => {
    const list = listToDelete;
    if (!list) return;
    setListToDelete(null);
    await deleteList(list.id);
    void qc.invalidateQueries({ queryKey: ["lists"] });
  };

  if (isLoading)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  return (
    <div>
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">My Lists</h1>
          <p className="mt-1 text-sm text-pitflix-muted">{lists.length} lists</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 rounded-xl bg-pitflix-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-pitflix-light"
        >
          <span className="text-lg leading-none">+</span>
          New List
        </button>
      </div>

      {creating ? (
        <div className="mb-4 rounded-xl border border-pitflix-primary/30 bg-pitflix-card p-4">
          <p className="mb-3 text-sm font-medium text-white">New List Name</p>
          <div className="flex flex-wrap gap-2">
            <input
              autoFocus
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="e.g. Weekend Watchlist"
              className="min-w-[200px] flex-1 rounded-lg border border-pitflix-card bg-pitflix-surface px-3 py-2 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={!newListName.trim()}
              className="rounded-lg bg-pitflix-primary px-4 py-2 text-sm text-white hover:bg-pitflix-light disabled:opacity-40"
            >
              Create
            </button>
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="px-3 py-2 text-sm text-pitflix-muted hover:text-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {lists.map((list) => (
          <div
            key={list.id}
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/lists/${list.id}`)}
            onKeyDown={(e) => e.key === "Enter" && navigate(`/lists/${list.id}`)}
            className="group cursor-pointer rounded-xl bg-pitflix-card p-5 transition-all hover:bg-pitflix-card/80 hover:ring-1 hover:ring-pitflix-primary/50"
          >
            <div className="mb-3 text-3xl">
              {list.name.startsWith("❤") ? "❤️" : list.name.startsWith("⏰") ? "⏰" : "📋"}
            </div>
            <p className="font-semibold text-white truncate">{list.name}</p>
            <p className="mt-1 text-xs text-pitflix-muted">{list.itemCount ?? 0} items</p>
            {!list.isDefault ? (
              <button
                type="button"
                onClick={(e) => handleDelete(e, list)}
                className="mt-3 text-xs text-pitflix-subtle opacity-0 transition-all hover:text-red-400 group-hover:opacity-100"
              >
                🗑️ Delete
              </button>
            ) : null}
          </div>
        ))}
      </div>

      <ConfirmDialog
        open={listToDelete != null}
        title="Delete list?"
        description={
          listToDelete
            ? `Delete “${listToDelete.name}”? Titles remain in your library; only this list is removed.`
            : ""
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => void confirmDeleteList()}
        onCancel={() => setListToDelete(null)}
      />
    </div>
  );
}

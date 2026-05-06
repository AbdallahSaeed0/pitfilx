import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createList, deleteList, getLists, renameList } from "../api/lists";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { Spinner } from "../components/ui/Spinner";
import { Pencil } from "lucide-react";
import { cn } from "../utils/cn";
import { decodeListTitle, encodeListName, LIST_MARK_OPTIONS, ListMarkGlyph } from "../utils/listMarks";

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
  const [selectedMarkId, setSelectedMarkId] = useState("gem");
  const [listToDelete, setListToDelete] = useState<ListRow | null>(null);
  const [editing, setEditing] = useState<ListRow | null>(null);
  const [editName, setEditName] = useState("");

  const lists = (data ?? []) as ListRow[];

  const handleCreate = async () => {
    const raw = newListName.trim();
    if (!raw) return;
    const name = encodeListName(selectedMarkId, raw);
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

  const openEdit = (e: React.MouseEvent, list: ListRow) => {
    e.stopPropagation();
    if (list.isDefault) return;
    const d = decodeListTitle(list.name);
    setSelectedMarkId(d.mode === "icon" ? d.iconId : "gem");
    setEditName(d.title);
    setEditing(list);
  };

  const handleSaveEdit = async () => {
    const list = editing;
    const raw = editName.trim();
    if (!list || !raw) return;
    await renameList(list.id, { name: encodeListName(selectedMarkId, raw) });
    setEditing(null);
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
          onClick={() => {
            setSelectedMarkId("gem");
            setNewListName("");
            setCreating(true);
          }}
          className="flex items-center gap-2 rounded-xl bg-pitflix-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-pitflix-light"
        >
          <span className="text-lg leading-none">+</span>
          New List
        </button>
      </div>

      {creating ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="new-list-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gradient-to-b from-zinc-900/98 to-pitflix-bg p-6 shadow-2xl shadow-black/80 ring-1 ring-white/5">
            <h2 id="new-list-title" className="text-lg font-semibold text-white">
              New list
            </h2>
            <p className="mt-1 text-xs text-pitflix-muted">Choose a mark and name your list.</p>

            <p className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">Mark</p>
            <div className="mb-5 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {LIST_MARK_OPTIONS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  onClick={() => setSelectedMarkId(id)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-xl border transition",
                    selectedMarkId === id
                      ? "border-pitflix-primary bg-pitflix-primary/20 shadow-[0_0_16px_rgba(139,92,246,0.35)] text-violet-200"
                      : "border-white/10 bg-black/30 text-pitflix-muted hover:border-pitflix-primary/40 hover:text-white",
                  )}
                >
                  <Icon className="h-7 w-7" strokeWidth={1.35} />
                </button>
              ))}
            </div>

            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">
              Name
            </label>
            <input
              autoFocus
              value={newListName}
              onChange={(e) => setNewListName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreate();
                if (e.key === "Escape") setCreating(false);
              }}
              placeholder="e.g. Weekend watchlist"
              className="mb-5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25"
            />

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-pitflix-muted hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={!newListName.trim()}
                className="rounded-xl bg-pitflix-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-pitflix-light disabled:opacity-40"
              >
                Create list
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editing ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4 py-8 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-list-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-white/10 bg-gradient-to-b from-zinc-900/98 to-pitflix-bg p-6 shadow-2xl shadow-black/80 ring-1 ring-white/5">
            <h2 id="edit-list-title" className="text-lg font-semibold text-white">
              Edit list
            </h2>
            <p className="mt-1 text-xs text-pitflix-muted">Change mark and display name.</p>

            <p className="mb-2 mt-5 text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">Mark</p>
            <div className="mb-5 grid grid-cols-4 gap-2 sm:grid-cols-6">
              {LIST_MARK_OPTIONS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  onClick={() => setSelectedMarkId(id)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-xl border transition",
                    selectedMarkId === id
                      ? "border-pitflix-primary bg-pitflix-primary/20 shadow-[0_0_16px_rgba(139,92,246,0.35)] text-violet-200"
                      : "border-white/10 bg-black/30 text-pitflix-muted hover:border-pitflix-primary/40 hover:text-white",
                  )}
                >
                  <Icon className="h-7 w-7" strokeWidth={1.35} />
                </button>
              ))}
            </div>

            <label className="mb-2 block text-[10px] font-semibold uppercase tracking-wide text-pitflix-muted">Name</label>
            <input
              autoFocus
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSaveEdit();
                if (e.key === "Escape") setEditing(null);
              }}
              className="mb-5 w-full rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-white placeholder:text-pitflix-subtle focus:border-pitflix-primary focus:outline-none focus:ring-2 focus:ring-pitflix-primary/25"
            />

            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-xl border border-white/15 px-4 py-2.5 text-sm text-pitflix-muted hover:text-white"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveEdit()}
                disabled={!editName.trim()}
                className="rounded-xl bg-pitflix-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-pitflix-light disabled:opacity-40"
              >
                Save
              </button>
            </div>
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
            <div className="mb-3 flex h-14 items-center justify-center drop-shadow-[0_2px_12px_rgba(0,0,0,0.55)]">
              <ListMarkGlyph name={list.name} />
            </div>
            <p className="font-semibold text-white truncate">{decodeListTitle(list.name).title}</p>
            <p className="mt-1 text-xs text-pitflix-muted">{list.itemCount ?? 0} items</p>
            {!list.isDefault ? (
              <div className="mt-3 flex flex-wrap gap-3 opacity-0 transition-all group-hover:opacity-100">
                <button
                  type="button"
                  onClick={(e) => openEdit(e, list)}
                  className="inline-flex items-center gap-1 text-xs text-pitflix-subtle hover:text-violet-300"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={(e) => handleDelete(e, list)}
                  className="text-xs text-pitflix-subtle hover:text-red-400"
                >
                  Delete
                </button>
              </div>
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

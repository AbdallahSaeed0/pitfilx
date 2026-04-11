import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

export type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** If true, only the primary button is shown (e.g. “Got it” for info text). */
  confirmOnly?: boolean;
  /** Danger styles the confirm action as destructive (e.g. remove). */
  variant?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  confirmOnly = false,
  variant = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[240] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onCancel}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
            aria-describedby="confirm-dialog-desc"
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="w-full max-w-[420px] rounded-xl border border-pitflix-primary/25 bg-pitflix-surface shadow-2xl shadow-black/70 ring-1 ring-white/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-pitflix-card px-5 py-4">
              <h2 id="confirm-dialog-title" className="text-lg font-semibold text-white">
                {title}
              </h2>
              <p id="confirm-dialog-desc" className="mt-2 text-sm leading-relaxed text-pitflix-muted">
                {description}
              </p>
            </div>
            <div className="flex flex-wrap justify-end gap-2 px-5 py-4">
              {!confirmOnly ? (
                <button
                  type="button"
                  className="rounded-lg border border-pitflix-card bg-pitflix-bg px-4 py-2.5 text-sm font-medium text-pitflix-muted transition-colors hover:border-pitflix-primary/40 hover:text-white"
                  onClick={onCancel}
                >
                  {cancelLabel}
                </button>
              ) : null}
              <button
                type="button"
                className={
                  variant === "danger"
                    ? "rounded-lg bg-red-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-500"
                    : "rounded-lg bg-pitflix-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pitflix-light"
                }
                onClick={onConfirm}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

import { AnimatePresence, motion } from "framer-motion";
import { Check, Copy, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "../../utils/cn";

export type ApiKeyGuideModalProps = {
  open: boolean;
  title: string;
  steps: ReactNode[];
  onClose: () => void;
};

export type ApiKeyGuideCopyField = {
  label: string;
  value: string;
};

function copyText(text: string) {
  return navigator.clipboard?.writeText(text) ?? Promise.reject();
}

function CopyButton({
  label,
  copied,
  onCopy,
  compact,
}: {
  label: string;
  copied: boolean;
  onCopy: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={copied ? "Copied" : `Copy ${label}`}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-lg border font-medium transition-all",
        compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]",
        copied
          ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
          : "border-white/10 bg-white/[0.04] text-pitflix-muted hover:border-pitflix-primary/40 hover:bg-pitflix-primary/10 hover:text-white",
      )}
      onClick={(e) => {
        e.stopPropagation();
        onCopy();
      }}
    >
      {copied ? (
        <>
          <Check className="h-3 w-3" strokeWidth={2.5} />
          Copied
        </>
      ) : (
        <>
          <Copy className="h-3 w-3" strokeWidth={2} />
          Copy
        </>
      )}
    </button>
  );
}

export function ApiKeyGuideCopyBlock({ fields }: { fields: ApiKeyGuideCopyField[] }) {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [copiedAll, setCopiedAll] = useState(false);

  const flash = (key: string, setAll = false) => {
    if (setAll) {
      setCopiedAll(true);
      window.setTimeout(() => setCopiedAll(false), 1600);
      return;
    }
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(null), 1600);
  };

  const copyField = (field: ApiKeyGuideCopyField) => {
    void copyText(field.value)
      .then(() => flash(field.label))
      .catch(() => {});
  };

  const copyAll = () => {
    const text = fields.map((f) => `${f.label}: ${f.value}`).join("\n");
    void copyText(text)
      .then(() => flash("", true))
      .catch(() => {});
  };

  return (
    <div
      className="mt-2.5 overflow-hidden rounded-xl border border-white/10 bg-pitflix-bg/80 shadow-inner shadow-black/20"
      data-no-window-drag
    >
      <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] bg-white/[0.02] px-3 py-2">
        <span className="text-[10px] font-semibold tracking-wider text-pitflix-subtle uppercase">
          Form values
        </span>
        <CopyButton label="all fields" copied={copiedAll} onCopy={copyAll} compact />
      </div>
      <div className="space-y-3 p-3">
        {fields.map((field) => {
          const copied = copiedKey === field.label;
          return (
            <div key={field.label} className="space-y-1">
              <span className="text-[10px] font-medium text-pitflix-muted">{field.label}</span>
              <button
                type="button"
                className={cn(
                  "group flex w-full items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-all",
                  copied
                    ? "border-emerald-500/35 bg-emerald-500/[0.07]"
                    : "border-white/[0.08] bg-black/25 hover:border-pitflix-primary/30 hover:bg-pitflix-primary/[0.06]",
                )}
                title="Click to copy"
                onClick={() => copyField(field)}
              >
                <span className="min-w-0 flex-1 text-[11px] leading-relaxed text-white select-text">
                  {field.value}
                </span>
                <span
                  className={cn(
                    "pointer-events-none pt-0.5 opacity-0 transition-opacity group-hover:opacity-100",
                    copied && "opacity-100",
                  )}
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2.5} />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-pitflix-subtle" strokeWidth={2} />
                  )}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ApiKeyGuideModal({ open, title, steps, onClose }: ApiKeyGuideModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[240] flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-key-guide-title"
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ type: "spring", damping: 28, stiffness: 320 }}
            className="w-full max-w-[500px] rounded-xl border border-pitflix-primary/25 bg-pitflix-surface shadow-2xl shadow-black/70 ring-1 ring-white/5"
            data-no-window-drag
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-pitflix-card px-5 py-4">
              <h2 id="api-key-guide-title" className="text-sm font-semibold text-white">
                {title}
              </h2>
              <button
                type="button"
                aria-label="Close"
                className="rounded-lg p-1 text-pitflix-muted transition-colors hover:text-white"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[min(70vh,520px)] overflow-y-auto px-5 py-4">
              <ol className="list-decimal space-y-3 pl-4 text-[12px] leading-relaxed text-white">
                {steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </div>
            <div className="flex justify-end border-t border-white/[0.06] px-5 py-4">
              <button
                type="button"
                className="rounded-lg bg-pitflix-primary px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-pitflix-light"
                onClick={onClose}
              >
                Got it
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function EmptyState({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-pitflix-subtle/40 bg-pitflix-surface/50 p-10 text-center">
      <p className="font-medium text-pitflix-muted">{title}</p>
      {subtitle ? <p className="mt-1 text-sm text-pitflix-subtle">{subtitle}</p> : null}
    </div>
  );
}

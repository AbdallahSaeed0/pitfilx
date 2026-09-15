import { useNavigate } from "react-router-dom";

/**
 * Consistent "← Back" affordance for pages reached by drilling in from elsewhere (Home rows,
 * search, other list pages) — mirrors the treatment already used on Stats and the movie/show
 * detail pages. Uses browser history like those; no history means the click no-ops, same as
 * the existing back buttons.
 */
export function BackButton({ className = "mb-3" }: { className?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(-1)}
      className={`text-sm text-pitflix-muted transition-colors hover:text-white ${className}`}
    >
      ← Back
    </button>
  );
}

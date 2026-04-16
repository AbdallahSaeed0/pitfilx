import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

type PlayerActionButtonProps = {
  variant?: "primary" | "secondary" | "tertiary";
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
};

export function PlayerActionButton({
  variant = "primary",
  children,
  onClick,
  disabled,
  className,
}: PlayerActionButtonProps) {
  const baseStyles = "inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed";

  const variantStyles = {
    primary:
      "h-12 rounded-xl bg-pitflix-accent-primary px-6 text-sm text-white hover:bg-pitflix-accent-hover shadow-lg hover:shadow-xl",
    secondary:
      "h-10 rounded-lg border border-pitflix-border-subtle bg-pitflix-bg-card/50 px-4 text-sm text-pitflix-text-secondary hover:bg-pitflix-bg-elevated hover:border-pitflix-border-medium",
    tertiary:
      "h-10 w-10 rounded-lg bg-pitflix-bg-elevated hover:bg-pitflix-border-subtle text-pitflix-text-secondary",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(baseStyles, variantStyles[variant], className)}
    >
      {children}
    </button>
  );
}

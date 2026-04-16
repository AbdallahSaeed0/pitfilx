import type { ReactNode } from "react";
import { cn } from "../../utils/cn";

type CinematicPlayerShellProps = {
  children: ReactNode;
  className?: string;
};

export function CinematicPlayerShell({ children, className }: CinematicPlayerShellProps) {
  return (
    <div
      className={cn(
        "flex min-h-screen flex-col items-center bg-pitflix-bg-base",
        className
      )}
    >
      <div className="flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:px-8">
        {children}
      </div>
    </div>
  );
}

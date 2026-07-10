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
        "flex min-h-screen flex-col overflow-y-auto bg-pitflix-bg-base",
        className
      )}
    >
      <div className="flex w-full flex-1 flex-col items-center gap-4 px-6 py-4 sm:px-10">
        {children}
      </div>
    </div>
  );
}

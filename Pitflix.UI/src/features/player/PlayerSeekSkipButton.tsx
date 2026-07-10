import type { ReactNode } from "react";
import { useHoldRepeat } from "./useHoldRepeat";

type Props = {
  deltaSeconds: number;
  disabled?: boolean;
  className?: string;
  title: string;
  onSeek: (deltaSeconds: number) => void;
  children: ReactNode;
};

export function PlayerSeekSkipButton({
  deltaSeconds,
  disabled,
  className,
  title,
  onSeek,
  children,
}: Props) {
  const hold = useHoldRepeat(() => onSeek(deltaSeconds), { disabled });

  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className={className}
      {...hold}
    >
      {children}
    </button>
  );
}

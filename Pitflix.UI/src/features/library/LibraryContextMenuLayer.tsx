import { MediaContextMenu } from "./MediaContextMenu";
import type { MediaContextTarget } from "./useMediaContextMenu";

type Props = {
  menu: { target: MediaContextTarget; x: number; y: number } | null;
  onClose: () => void;
  onAction: (action: "rescan" | "markWatched" | "markUnwatched") => void;
};

export function LibraryContextMenuLayer({ menu, onClose, onAction }: Props) {
  if (!menu) return null;
  return (
    <MediaContextMenu
      label={menu.target.title}
      x={menu.x}
      y={menu.y}
      watchStatus={"watchStatus" in menu.target ? menu.target.watchStatus : undefined}
      showRescan={menu.target.kind !== "streaming"}
      onAction={onAction}
      onClose={onClose}
    />
  );
}

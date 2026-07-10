import { ConfirmDialog } from "../ui/ConfirmDialog";
import { usePitflixConfirmStore } from "../../store/pitflixConfirmStore";

/** Renders the themed confirm dialog for `pitflixConfirm(...)` calls anywhere in the app. */
export function PitflixConfirmHost() {
  const request = usePitflixConfirmStore((s) => s.request);
  const respond = usePitflixConfirmStore((s) => s.respond);

  return (
    <ConfirmDialog
      open={request != null}
      title="Pitflix"
      description={request?.message ?? ""}
      onConfirm={() => respond(true)}
      onCancel={() => respond(false)}
    />
  );
}

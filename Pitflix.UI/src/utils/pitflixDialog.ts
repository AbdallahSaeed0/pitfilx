import { usePitflixConfirmStore } from "../store/pitflixConfirmStore";

/** Themed in-app OK/Cancel prompt (renders via `<PitflixConfirmHost />` in `MainLayout`),
 * matching the app's own dialog style instead of a native OS message box. */
export function pitflixConfirm(message: string): Promise<boolean> {
  return usePitflixConfirmStore.getState().ask(message);
}

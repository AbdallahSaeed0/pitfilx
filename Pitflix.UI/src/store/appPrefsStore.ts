import { create } from "zustand";
import { persist } from "zustand/middleware";

type AppPrefsState = {
  /** When true, the desktop app checks for updates once after launch (never auto-installs). */
  checkUpdatesOnStartup: boolean;
  setCheckUpdatesOnStartup: (value: boolean) => void;
};

export const useAppPrefsStore = create<AppPrefsState>()(
  persist(
    (set) => ({
      checkUpdatesOnStartup: false,
      setCheckUpdatesOnStartup: (checkUpdatesOnStartup) => set({ checkUpdatesOnStartup }),
    }),
    { name: "pitflix-app-prefs" },
  ),
);

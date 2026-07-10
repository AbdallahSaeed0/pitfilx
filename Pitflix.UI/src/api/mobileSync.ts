import api from "./client";

export type MobileSyncStatus = {
  linked: boolean;
  email: string | null;
  lastSyncedAt: string | null;
};

export const getMobileSyncStatus = () =>
  api.get<MobileSyncStatus>("/mobile-sync/status").then((r) => r.data);

export type MobileSyncLinkResult = {
  success: boolean;
  email?: string;
  error?: string;
  pushed?: boolean;
  pushError?: string;
};

export const linkMobileAccount = (email: string, password: string) =>
  api
    .post<MobileSyncLinkResult>("/mobile-sync/link", { email, password })
    .then((r) => r.data)
    .catch((err) => {
      const data = err?.response?.data as MobileSyncLinkResult | undefined;
      return data ?? { success: false, error: "Couldn't reach the desktop backend." };
    });

export const unlinkMobileAccount = () =>
  api.post<{ success: boolean }>("/mobile-sync/unlink", {}).then((r) => r.data);

export type MobileSyncPushResult = { success: boolean; error?: string };

export const pushMobileSync = () =>
  api
    .post<MobileSyncPushResult>("/mobile-sync/push", {})
    .then((r) => r.data)
    .catch((err) => {
      const data = err?.response?.data as MobileSyncPushResult | undefined;
      return data ?? { success: false, error: "Couldn't reach the desktop backend." };
    });

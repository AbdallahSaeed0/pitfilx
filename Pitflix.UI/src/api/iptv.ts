import api from "./client";

export type IptvProviderType = "M3uUrl" | "XtreamCodes" | "EpgOnly";

export type IptvProvider = {
  id: number;
  displayName: string;
  type: IptvProviderType;
  m3uUrl?: string | null;
  serverUrl?: string | null;
  username?: string | null;
  epgUrl?: string | null;
  channelCount: number;
  createdAt: string;
  lastRefreshedAt?: string | null;
};

export type IptvChannel = {
  id: number;
  providerId: number;
  name: string;
  streamUrl: string;
  logoUrl?: string | null;
  group?: string | null;
  tvgId?: string | null;
  tvgName?: string | null;
  streamId?: string | null;
  sortOrder: number;
};

export type CreateProviderPayload = {
  displayName: string;
  type: IptvProviderType;
  m3uUrl?: string;
  serverUrl?: string;
  username?: string;
  password?: string;
  epgUrl?: string;
};

export const getProviders = () =>
  api.get<IptvProvider[]>("/iptv/providers").then((r) => r.data);

export const getProviderById = (id: number) =>
  api.get<IptvProvider>(`/iptv/providers/${id}`).then((r) => r.data);

export const createProvider = (body: CreateProviderPayload) =>
  api.post<{ id: number }>("/iptv/providers", body).then((r) => r.data);

export const updateProvider = (id: number, body: CreateProviderPayload) =>
  api.put(`/iptv/providers/${id}`, body).then((r) => r.data);

export const deleteProvider = (id: number) =>
  api.delete(`/iptv/providers/${id}`).then((r) => r.data);

export const refreshProvider = (id: number) =>
  api.post<{ channelCount: number }>(`/iptv/providers/${id}/refresh`).then((r) => r.data);

export const importM3uContent = (id: number, content: string) =>
  api
    .post<{ channelCount: number }>(`/iptv/providers/${id}/import-m3u`, content, {
      headers: { "Content-Type": "text/plain" },
    })
    .then((r) => r.data);

export const testXtreamConnection = (serverUrl: string, username: string, password: string) =>
  api
    .post<{ success: boolean }>("/iptv/test-xtream", { serverUrl, username, password })
    .then((r) => r.data);

export const getChannels = (id: number, params?: { group?: string; search?: string }) =>
  api.get<IptvChannel[]>(`/iptv/providers/${id}/channels`, { params }).then((r) => r.data);

export const getGroups = (id: number) =>
  api.get<string[]>(`/iptv/providers/${id}/groups`).then((r) => r.data);

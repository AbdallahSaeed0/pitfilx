import api from "./client";

export type UserListSummary = {
  id: number;
  name: string;
  createdAt: string;
  isDefault: boolean;
  itemCount: number;
};

export const getLists = () => api.get<UserListSummary[]>("/lists").then((r) => r.data);

export type UserListMeta = {
  id: number;
  name: string;
  isDefault: boolean;
};

export const getListById = (id: number) => api.get<UserListMeta>(`/lists/${id}`).then((r) => r.data);

export const createList = (body: { name: string }) =>
  api.post("/lists", body).then((r) => r.data);

export const deleteList = (id: number) =>
  api.delete(`/lists/${id}`).then((r) => r.data);

export const getListItems = (id: number) =>
  api.get(`/lists/${id}/items`).then((r) => r.data);

export const addListItem = (id: number, body: { tmdbId: number; mediaType: string }) =>
  api.post(`/lists/${id}/items`, body).then((r) => r.data);

export const removeListItem = (listId: number, tmdbId: number, mediaType: string) =>
  api
    .delete(`/lists/${listId}/items/${tmdbId}`, { params: { mediaType } })
    .then((r) => r.data);

export const listContains = (listId: number, params: { tmdbId: number; mediaType: string }) =>
  api.get<{ inList: boolean }>(`/lists/${listId}/contains`, { params }).then((r) => r.data);

export const getListTmdbIds = (listId: number, mediaType: string) =>
  api.get<number[]>(`/lists/${listId}/tmdb-ids`, { params: { mediaType } }).then((r) => r.data);

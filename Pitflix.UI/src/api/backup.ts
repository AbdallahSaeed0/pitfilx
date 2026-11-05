import api from "./client";

export type LibraryBackupImportResult = {
  moviesAdded: number;
  moviesUpdated: number;
  showsAdded: number;
  showsUpdated: number;
  episodesAdded: number;
  episodesUpdated: number;
  castMembersAdded: number;
  libraryFoldersAdded: number;
  listsAdded: number;
  listItemsAdded: number;
  watchHistoryAdded: number;
  ratingsAdded: number;
  settingsAdded: number;
  traktRestored: boolean;
};

/** Raw backup JSON text, ready to write straight to a file. */
export const fetchLibraryBackupJson = () =>
  api.get<string>("/library/backup/export", { responseType: "text", transformResponse: (d) => d }).then((r) => r.data);

export const importLibraryBackupJson = (json: string) =>
  api
    .post<LibraryBackupImportResult>("/library/backup/import", json, {
      headers: { "Content-Type": "application/json" },
    })
    .then((r) => r.data);

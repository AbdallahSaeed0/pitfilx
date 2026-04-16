export type PlaybackStatus = 
  | "loading"
  | "playing"
  | "paused"
  | "finished"
  | "closed"
  | "error";

export type PlaybackStatusInfo = {
  label: string;
  color: string;
  bgColor: string;
  textColor: string;
};

export function mapPlaybackStatus(
  loading: boolean,
  paused: boolean,
  ended: boolean,
  sessionDead: boolean,
  transportError: string | null
): PlaybackStatus {
  if (transportError) return "error";
  if (loading) return "loading";
  if (sessionDead) return "closed";
  if (ended) return "finished";
  if (paused) return "paused";
  return "playing";
}

export function getStatusInfo(status: PlaybackStatus): PlaybackStatusInfo {
  switch (status) {
    case "loading":
      return {
        label: "Loading",
        color: "bg-pitflix-status-finished",
        bgColor: "bg-blue-500/10",
        textColor: "text-blue-300",
      };
    case "playing":
      return {
        label: "Playing",
        color: "bg-pitflix-status-playing",
        bgColor: "bg-green-500/10",
        textColor: "text-green-300",
      };
    case "paused":
      return {
        label: "Paused",
        color: "bg-pitflix-status-paused",
        bgColor: "bg-amber-500/10",
        textColor: "text-amber-300",
      };
    case "finished":
      return {
        label: "Finished",
        color: "bg-pitflix-status-finished",
        bgColor: "bg-blue-500/10",
        textColor: "text-blue-300",
      };
    case "closed":
      return {
        label: "Reconnecting",
        color: "bg-pitflix-status-closed",
        bgColor: "bg-gray-500/10",
        textColor: "text-gray-300",
      };
    case "error":
      return {
        label: "Connection Issue",
        color: "bg-pitflix-status-error",
        bgColor: "bg-red-500/10",
        textColor: "text-red-300",
      };
  }
}

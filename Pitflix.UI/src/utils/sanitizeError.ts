/**
 * Sanitizes technical error messages into user-friendly text.
 * Removes technical jargon like EOF, IPC, transport, etc.
 */
export function sanitizeErrorMessage(rawError: string | null | undefined): string | null {
  if (!rawError) return null;

  const lower = rawError.toLowerCase();

  // Map common technical errors to friendly messages
  if (lower.includes("eof") || lower.includes("disconnected")) {
    return "Player connection lost";
  }

  if (lower.includes("ipc")) {
    return "Player communication error";
  }

  if (lower.includes("transport")) {
    return "Playback connection issue";
  }

  if (lower.includes("pipe") || lower.includes("broken pipe")) {
    return "Player connection interrupted";
  }

  if (lower.includes("timeout")) {
    return "Player not responding";
  }

  if (lower.includes("failed to") || lower.includes("could not")) {
    return "Player operation failed";
  }

  // If no technical terms found, return the original message
  // but limit length to avoid overwhelming users
  if (rawError.length > 100) {
    return "Player encountered an error";
  }

  return rawError;
}

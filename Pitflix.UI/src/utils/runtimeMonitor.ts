/**
 * Runtime resource monitoring for diagnosing performance issues
 */

type MonitorStats = {
  startTime: number;
  pollCount: number;
  progressSaveCount: number;
  queryInvalidationCount: number;
  rerenderCount: number;
  ipcEventCount: number;
  ipcEventTypes: Map<string, number>;
  lastReportTime: number;
};

const stats: MonitorStats = {
  startTime: 0,
  pollCount: 0,
  progressSaveCount: 0,
  queryInvalidationCount: 0,
  rerenderCount: 0,
  ipcEventCount: 0,
  ipcEventTypes: new Map(),
  lastReportTime: 0,
};

let monitorInterval: ReturnType<typeof setInterval> | null = null;

export function startRuntimeMonitor() {
  stats.startTime = performance.now();
  stats.pollCount = 0;
  stats.progressSaveCount = 0;
  stats.queryInvalidationCount = 0;
  stats.rerenderCount = 0;
  stats.ipcEventCount = 0;
  stats.ipcEventTypes.clear();
  stats.lastReportTime = performance.now();

  console.log("[playback-monitor] Starting runtime monitoring...");

  // Report every 2 seconds
  monitorInterval = setInterval(() => {
    const now = performance.now();
    const elapsed = (now - stats.startTime) / 1000;
    const sinceLast = (now - stats.lastReportTime) / 1000;

    const pollsPerSec = stats.pollCount / sinceLast;
    const progressPerSec = stats.progressSaveCount / sinceLast;
    const invalidationsPerSec = stats.queryInvalidationCount / sinceLast;
    const ipcPerSec = stats.ipcEventCount / sinceLast;

    console.log(`[playback-monitor] elapsed=${elapsed.toFixed(1)}s polls/s=${pollsPerSec.toFixed(1)} progress/s=${progressPerSec.toFixed(1)} invalidations/s=${invalidationsPerSec.toFixed(1)} ipc/s=${ipcPerSec.toFixed(1)} rerenders=${stats.rerenderCount}`);

    // Show top IPC event types
    if (stats.ipcEventTypes.size > 0) {
      const sorted = Array.from(stats.ipcEventTypes.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      const topEvents = sorted.map(([type, count]) => `${type}=${count}`).join(' ');
      console.log(`[top-ipc-events] ${topEvents}`);
    }

    // Check for hot paths
    if (pollsPerSec > 5) {
      console.warn("[playback-monitor] ⚠️ HIGH POLLING RATE:", pollsPerSec.toFixed(1), "polls/sec");
    }
    if (progressPerSec > 0.5) {
      console.warn("[playback-monitor] ⚠️ HIGH PROGRESS SAVE RATE:", progressPerSec.toFixed(1), "saves/sec");
    }
    if (invalidationsPerSec > 0.5) {
      console.warn("[playback-monitor] ⚠️ HIGH QUERY INVALIDATION RATE:", invalidationsPerSec.toFixed(1), "invalidations/sec");
    }
    if (ipcPerSec > 10) {
      console.warn("[playback-monitor] ⚠️ HIGH IPC EVENT RATE:", ipcPerSec.toFixed(1), "events/sec");
    }

    // Reset counters for next interval
    stats.pollCount = 0;
    stats.progressSaveCount = 0;
    stats.queryInvalidationCount = 0;
    stats.ipcEventCount = 0;
    stats.ipcEventTypes.clear();
    stats.lastReportTime = now;
  }, 2000);

  // Summary after 15 seconds
  setTimeout(() => {
    const elapsed = (performance.now() - stats.startTime) / 1000;
    console.log(`[playback-runtime-summary] elapsed=${elapsed.toFixed(1)}s total_rerenders=${stats.rerenderCount}`);
  }, 15000);
}

export function stopRuntimeMonitor() {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
    console.log("[playback-monitor] Stopped monitoring");
  }
}

export function trackPoll() {
  stats.pollCount++;
}

export function trackProgressSave() {
  stats.progressSaveCount++;
}

export function trackQueryInvalidation() {
  stats.queryInvalidationCount++;
}

export function trackRerender() {
  stats.rerenderCount++;
}

export function trackIpcEvent(eventType?: string) {
  stats.ipcEventCount++;
  if (eventType) {
    stats.ipcEventTypes.set(eventType, (stats.ipcEventTypes.get(eventType) || 0) + 1);
  }
}

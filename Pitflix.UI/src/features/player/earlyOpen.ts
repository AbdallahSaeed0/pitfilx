/**
 * Libmpv open generation. Bumped on every open; a deferred shutdown (the close fade in
 * PlayerPage.exitAndClose) checks it first, so it can never tear down a session opened since.
 *
 * (This module also held an "early open" that started mpv from usePlayback before the player page
 * mounted. Removed 2026-10-10: it coincided with mpv cores shutting down right after initialize.)
 */
let openGeneration = 0;

export function bumpLibmpvOpenGeneration(): number {
  openGeneration += 1;
  return openGeneration;
}

export function currentLibmpvOpenGeneration(): number {
  return openGeneration;
}

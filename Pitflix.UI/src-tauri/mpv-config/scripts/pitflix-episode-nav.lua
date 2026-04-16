-- Pitflix episode navigation: Shift+N / Shift+P → stdout marker → Rust parses mpv stdout → `player2-shortcut`.

local msg = require 'mp.msg'

local function emit_shortcut(code)
  -- Primary bridge: custom mpv user-data property observed by Rust IPC loop.
  -- Include timestamp so repeated presses always trigger a value change.
  local payload = code .. ":" .. tostring(mp.get_time())
  mp.set_property_native("user-data/pitflix-shortcut", payload)
  -- Secondary diagnostic bridge (stdout marker).
  print("[PITFLIX_SHORTCUT]" .. code)
  io.stdout:flush()
end

local function emit_stage(stage)
  print("[PITFLIX_SHORTCUT_STAGE]" .. stage)
  io.stdout:flush()
end

local function prev_episode()
  msg.info("pitflix: previous episode shortcut")
  emit_stage("prev_invoked")
  emit_shortcut("previous")
end

local function next_episode()
  msg.info("pitflix: next episode shortcut")
  emit_stage("next_invoked")
  emit_shortcut("next")
end

local function prev_episode_msg()
  msg.info("pitflix: previous episode message")
  emit_stage("prev_msg_invoked")
  emit_shortcut("previous")
end

local function next_episode_msg()
  msg.info("pitflix: next episode message")
  emit_stage("next_msg_invoked")
  emit_shortcut("next")
end

-- Startup probe: proves script loaded for the active mpv process.
print("[PITFLIX_SHORTCUT]script_loaded")
io.stdout:flush()
emit_stage("script_loaded")

-- Bound from `input.conf` via `script-binding pitflix-*`; keep nil default key here.
mp.add_key_binding(nil, "pitflix-prev-episode", prev_episode)
mp.add_key_binding(nil, "pitflix-next-episode", next_episode)
-- Hard fallback: force direct hotkeys even if input.conf binding chain is bypassed.
mp.add_forced_key_binding("Shift+p", "pitflix-prev-episode-hotkey", prev_episode, {repeatable = false})
mp.add_forced_key_binding("Shift+n", "pitflix-next-episode-hotkey", next_episode, {repeatable = false})
-- Exposed messages so uosc command buttons can call app-aware episode transitions.
mp.register_script_message("pitflix-prev-episode-msg", prev_episode_msg)
mp.register_script_message("pitflix-next-episode-msg", next_episode_msg)

msg.info("Pitflix episode navigation script loaded (stdout → player2-shortcut)")

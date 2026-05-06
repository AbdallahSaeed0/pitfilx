-- Pitflix media-player-owned controls.
-- This script is intentionally mpv-only: key ownership here must work even if the companion page
-- is unfocused or temporarily unavailable.

local msg = require "mp.msg"

local function osd(text)
  mp.osd_message(text, 1.2)
end

local function emit_shortcut(code)
  local payload = code .. ":" .. tostring(mp.get_time())
  mp.set_property_native("user-data/pitflix-shortcut", payload)
  print("[PITFLIX_SHORTCUT]" .. code)
  io.stdout:flush()
end

local function seek_relative(delta)
  mp.commandv("seek", tostring(delta), "relative")
end

local function add_sub_font_size(delta)
  local cur = tonumber(mp.get_property("sub-font-size")) or 52
  local nextv = math.max(24, math.min(90, cur + delta))
  mp.set_property_number("sub-font-size", nextv)
  osd(string.format("Subtitle size: %d", math.floor(nextv + 0.5)))
end

local function add_sub_pos(delta)
  local cur = tonumber(mp.get_property("sub-pos")) or 85
  local nextv = math.max(50, math.min(100, cur + delta))
  mp.set_property_number("sub-pos", nextv)
  osd(string.format("Subtitle vertical: %d", math.floor(nextv + 0.5)))
end

local function set_sub_style(name, color, border_color, border_size)
  mp.set_property("sub-color", color)
  mp.set_property("sub-border-color", border_color)
  mp.set_property_number("sub-border-size", border_size)
  osd("Subtitle style: " .. name)
end

local function sub_style_white()
  set_sub_style("White", "#FFFFFFFF", "#000000D0", 2.0)
end

local function sub_style_warm()
  set_sub_style("Warm", "#FFE7B0FF", "#000000D0", 2.0)
end

local function sub_style_cyan()
  set_sub_style("Cyan", "#9FE8FFFF", "#000000D0", 2.0)
end

local function sub_style_arabic()
  -- Higher contrast variant tuned for Arabic readability.
  set_sub_style("Arabic High Contrast", "#FFF4E0FF", "#000000F0", 2.6)
end

local function cycle_sub_style()
  local styles = { sub_style_white, sub_style_warm, sub_style_cyan, sub_style_arabic }
  local idx = tonumber(mp.get_property("user-data/pitflix-sub-style-idx")) or 0
  idx = (idx % #styles) + 1
  styles[idx]()
  mp.set_property_number("user-data/pitflix-sub-style-idx", idx)
end

--- Readable stroke on bright scenes (no uOSC bar button — shortcut only).
local function sub_strong_outline()
  mp.set_property("sub-border-color", "#000000FF")
  mp.set_property_number("sub-border-size", 3)
  osd("Subtitle outline: strong")
end

local function generate_arabic_subtitle()
  osd("Generating Arabic subtitle...")
  emit_shortcut("generate_arabic_subtitle")
end

-- Force-bind seek keys at mpv layer for reliability in external window.
mp.add_forced_key_binding("RIGHT", "pitflix-seek-right-5s", function() seek_relative(5) end, { repeatable = true })
mp.add_forced_key_binding("LEFT", "pitflix-seek-left-5s", function() seek_relative(-5) end, { repeatable = true })
mp.add_forced_key_binding("Shift+RIGHT", "pitflix-seek-right-1s", function() seek_relative(1) end, { repeatable = true })
mp.add_forced_key_binding("Shift+LEFT", "pitflix-seek-left-1s", function() seek_relative(-1) end, { repeatable = true })

-- Volume: match companion page / wheel step (5) instead of mpv default step.
local function add_volume(delta)
  local cur = mp.get_property_number("volume") or 0
  local vmax = mp.get_property_number("volume-max") or 100
  local nextv = math.max(0, math.min(vmax, cur + delta))
  mp.set_property_number("volume", nextv)
end
mp.add_forced_key_binding("UP", "pitflix-vol-up", function() add_volume(5) end, { repeatable = true })
mp.add_forced_key_binding("DOWN", "pitflix-vol-down", function() add_volume(-5) end, { repeatable = true })

-- Subtitle appearance controls (mpv-owned, live apply).
mp.add_forced_key_binding("Ctrl+UP", "pitflix-sub-size-up", function() add_sub_font_size(2) end, { repeatable = true })
mp.add_forced_key_binding("Ctrl+DOWN", "pitflix-sub-size-down", function() add_sub_font_size(-2) end, { repeatable = true })
mp.add_forced_key_binding("Alt+DOWN", "pitflix-sub-lower", function() add_sub_pos(2) end, { repeatable = true })
mp.add_forced_key_binding("Alt+UP", "pitflix-sub-higher", function() add_sub_pos(-2) end, { repeatable = true })
mp.add_forced_key_binding("Ctrl+1", "pitflix-sub-style-white", sub_style_white)
mp.add_forced_key_binding("Ctrl+2", "pitflix-sub-style-warm", sub_style_warm)
mp.add_forced_key_binding("Ctrl+3", "pitflix-sub-style-cyan", sub_style_cyan)
mp.add_forced_key_binding("Ctrl+4", "pitflix-sub-style-arabic", sub_style_arabic)
mp.add_forced_key_binding("Ctrl+b", "pitflix-sub-strong-outline", sub_strong_outline)
mp.add_forced_key_binding("Ctrl+g", "pitflix-generate-arabic-subtitle", generate_arabic_subtitle)

-- Script messages kept for automation / tests (uOSC bar does not bind these by default).
mp.register_script_message("pitflix-sub-size-up", function() add_sub_font_size(2) end)
mp.register_script_message("pitflix-sub-size-down", function() add_sub_font_size(-2) end)
mp.register_script_message("pitflix-sub-pos-up", function() add_sub_pos(-2) end)
mp.register_script_message("pitflix-sub-pos-down", function() add_sub_pos(2) end)
mp.register_script_message("pitflix-sub-style-cycle", cycle_sub_style)
mp.register_script_message("pitflix-sub-strong-outline", sub_strong_outline)
mp.register_script_message("pitflix-generate-arabic-subtitle", generate_arabic_subtitle)

msg.info("Pitflix media-player controls loaded (seek + volume + subtitle appearance + arabic subtitle generation)")

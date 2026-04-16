-- Pitflix media-player-owned controls.
-- This script is intentionally mpv-only: key ownership here must work even if the companion page
-- is unfocused or temporarily unavailable.

local msg = require "mp.msg"

local function osd(text)
  mp.osd_message(text, 1.2)
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

-- Force-bind seek keys at mpv layer for reliability in external window.
mp.add_forced_key_binding("RIGHT", "pitflix-seek-right-5s", function() seek_relative(5) end, { repeatable = true })
mp.add_forced_key_binding("LEFT", "pitflix-seek-left-5s", function() seek_relative(-5) end, { repeatable = true })
mp.add_forced_key_binding("Shift+RIGHT", "pitflix-seek-right-1s", function() seek_relative(1) end, { repeatable = true })
mp.add_forced_key_binding("Shift+LEFT", "pitflix-seek-left-1s", function() seek_relative(-1) end, { repeatable = true })

-- Subtitle appearance controls (mpv-owned, live apply).
mp.add_forced_key_binding("Ctrl+UP", "pitflix-sub-size-up", function() add_sub_font_size(2) end, { repeatable = true })
mp.add_forced_key_binding("Ctrl+DOWN", "pitflix-sub-size-down", function() add_sub_font_size(-2) end, { repeatable = true })
mp.add_forced_key_binding("Alt+DOWN", "pitflix-sub-lower", function() add_sub_pos(2) end, { repeatable = true })
mp.add_forced_key_binding("Alt+UP", "pitflix-sub-higher", function() add_sub_pos(-2) end, { repeatable = true })
mp.add_forced_key_binding("Ctrl+1", "pitflix-sub-style-white", sub_style_white)
mp.add_forced_key_binding("Ctrl+2", "pitflix-sub-style-warm", sub_style_warm)
mp.add_forced_key_binding("Ctrl+3", "pitflix-sub-style-cyan", sub_style_cyan)
mp.add_forced_key_binding("Ctrl+4", "pitflix-sub-style-arabic", sub_style_arabic)

-- Expose script messages for uosc control-bar buttons (mpv-window controls area).
mp.register_script_message("pitflix-sub-size-up", function() add_sub_font_size(2) end)
mp.register_script_message("pitflix-sub-size-down", function() add_sub_font_size(-2) end)
mp.register_script_message("pitflix-sub-pos-up", function() add_sub_pos(-2) end)
mp.register_script_message("pitflix-sub-pos-down", function() add_sub_pos(2) end)
mp.register_script_message("pitflix-sub-style-cycle", cycle_sub_style)

msg.info("Pitflix media-player controls loaded (seek + subtitle appearance)")

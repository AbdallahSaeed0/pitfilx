-- Pitflix Config Verification Script
-- Logs which config files and settings are actually loaded

local msg = require 'mp.msg'
local utils = require 'mp.utils'

msg.info("=== Pitflix Config Check ===")

-- Log config directory
local config_dir = mp.get_property("config-dir")
msg.info("Config directory: " .. (config_dir or "NONE"))

-- Log if uosc is loaded
local scripts = mp.get_property("script-list")
if scripts then
    msg.info("Loaded scripts: " .. scripts)
    if string.find(scripts, "uosc") then
        msg.info("✓ uosc is loaded")
    else
        msg.warn("✗ uosc is NOT loaded")
    end
end

-- Log timeline-related properties (if we can access them)
msg.info("=== End Config Check ===")

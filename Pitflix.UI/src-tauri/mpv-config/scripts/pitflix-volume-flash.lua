-- pitflix-volume-flash.lua
-- Flashes the uOSC volume bar whenever volume or mute changes (keyboard, scroll, etc.)
mp.observe_property("volume", "number", function(_, val)
    if val == nil then return end
    mp.commandv("script-message-to", "uosc", "flash-volume")
end)
mp.observe_property("mute", "bool", function(_, val)
    if val == nil then return end
    mp.commandv("script-message-to", "uosc", "flash-volume")
end)

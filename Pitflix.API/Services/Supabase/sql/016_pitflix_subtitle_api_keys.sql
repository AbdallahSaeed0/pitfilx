-- Extends 015's user_api_keys table with the desktop app's configured OpenSubtitles/SubDL
-- keys (Settings > Providers — see Pitflix.Core's AppSettings.ResolvedOpenSubtitlesApiKey and
-- the "SubDlApiKey" DB setting), so the mobile app's My Device local player can use the same
-- subtitle-provider keys automatically instead of requiring a second manual entry on the phone.
--
-- Requires 015 (this table). Idempotent, same pattern as every other migration here.

alter table public.user_api_keys
    add column if not exists opensubtitles_api_key text,
    add column if not exists subdl_api_key text;

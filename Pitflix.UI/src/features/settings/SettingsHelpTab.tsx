import { HelpCircle } from "lucide-react";
import type { SettingsPageModel } from "./useSettingsPageModel";

type Props = { model: SettingsPageModel };

export function SettingsHelpTab({ model }: Props) {
  const {

  } = model;

  return (
<section className="rounded-2xl border border-white/[0.09] bg-pitflix-surface/50 p-6 shadow-xl shadow-black/30 backdrop-blur-sm">
            <h2 className="mb-4 flex items-center gap-2 border-b border-white/[0.09] pb-4 text-[15px] font-bold tracking-tight text-white">
              <HelpCircle className="h-4 w-4 text-teal-400" strokeWidth={2} />
              Help &amp; FAQ
            </h2>
            <div>
              <div className="-mx-3">
              {([
                {
                  q: "How do I get a TMDB API key?",
                  a: "Go to themoviedb.org → sign up → Settings → API → Request an API key. Choose \"Developer\" use, fill in the form. Copy the API Read Access Token (v4 auth) or the API Key (v3). Paste it in the API keys tab and click Save keys.",
                },
                {
                  q: "Why does my library show 0 movies / series?",
                  a: "Make sure you've added at least one Library folder in the Library tab, saved it, then run Scan Library in Maintenance. The scan walks your folders looking for video files. Check that the folder path is accessible to the API process.",
                },
                {
                  q: "How do I get subtitles for a movie?",
                  a: "Open a movie or episode, then click the Subtitles button in the player. Pitflix uses OpenSubtitles (needs an API key) and SubDL (needs a separate key). Add both keys in the API keys tab for the best coverage.",
                },
                {
                  q: "Where do I get an OpenSubtitles API key?",
                  a: "Register at opensubtitles.com, then go to your profile → API Consumers → add a consumer. The key is your REST API key. Add it in the API keys tab.",
                },
                {
                  q: "Where do I get a SubDL API key?",
                  a: "Register at subdl.com, log in, go to your profile → API keys, and generate a key. It's free. Paste it in the API keys tab under SubDL.",
                },
                {
                  q: "Trailers are empty or not updating. What do I do?",
                  a: "Make sure your TMDB API key is valid. Then go to the Trailers page and click \"Refresh trailers\" — this triggers a fresh fetch from TMDB. You can also run trailer ingestion from Settings → Maintenance.",
                },
                {
                  q: "How does Online Streaming work?",
                  a: "The Online Streaming page searches TMDB for any movie or TV show. Click a result to open the detail page, then choose a streaming provider (StreamIMDB or CorsFlix) and press Play. Streams are embedded in-app via an iframe — availability depends on the third-party provider.",
                },
                {
                  q: "Awards page is empty. How do I populate it?",
                  a: "Go to Settings → Maintenance and click \"Update awards cache\". This downloads nominees for Oscar, Emmy, BAFTA, and Golden Globe ceremonies. It runs in the background — a panel at the bottom shows progress.",
                },
                {
                  q: "The app crashed or I see a blank screen. What next?",
                  a: "Make sure Pitflix.API is running (check the system tray or run \"dotnet run\" in the Pitflix.API folder). If the API is up but the UI still shows errors, open Settings → API Health Check to see which endpoints are failing. Check that your TMDB key is valid.",
                },
                {
                  q: "What is the difference between StreamIMDB and CorsFlix?",
                  a: "Both are online streaming providers embedded inside Pitflix. StreamIMDB uses the IMDb ID of the title to find a stream — it requires a valid IMDb ID. CorsFlix uses the TMDB ID instead and works even when an IMDb ID is unavailable. If one doesn't work, try the other with the provider toggle on the stream details page.",
                },
                {
                  q: "How do I add a movie or series to My List?",
                  a: "Open any movie or series detail page, or navigate to Online Streaming and open a title. Click the heart icon or \"Add to My List\" button. From Awards, use the Watchlist button on any nominee card. Your list is accessible from the sidebar under My Lists.",
                },
                {
                  q: "How do I remove an item from My List?",
                  a: "Go to My Lists, open the list, hover over any poster and click the red trash icon that appears in the top-right corner of the card. You can also open the title's detail page and click \"Remove from list\".",
                },
                {
                  q: "Why does a cast member's actor page only show library titles?",
                  a: "The person page shows your local library matches first, then loads the actor's full TMDB filmography below under \"Filmography\". Those cards link to the online streaming detail page. A valid TMDB API key is required to load the filmography.",
                },
                {
                  q: "Can I resume a movie or episode from where I left off?",
                  a: "Yes. Pitflix saves your playback position every few seconds and whenever you pause. The next time you open the same title, you'll be offered the option to resume from the last position. You can also see your continue-watching history on the Home page.",
                },
                {
                  q: "Can I use Pitflix without an internet connection?",
                  a: "Yes for local library playback — your files play through the built-in player with no internet needed. Subtitles search (OpenSubtitles / SubDL), poster images, trailers, awards data, online streaming, and TMDB metadata all require an internet connection.",
                },
                {
                  q: "Why are some posters missing or showing a placeholder?",
                  a: "Posters come from TMDB and are cached locally after the first load. If TMDB can't be reached or the key is missing, a placeholder is shown. Run \"Scan Library\" or \"Update metadata\" in Maintenance to trigger a fresh fetch. You can also manually pick a poster from the title's detail page (select from TMDB).",
                },
                {
                  q: "How do I change or set a custom media player?",
                  a: "Go to Settings → Library and set the Media Player Path to the full path of your player executable (e.g., C:\\Program Files\\VLC\\vlc.exe). Leave it empty to use your system's default app for the file type. The built-in libmpv player is available when no external player is configured.",
                },
                {
                  q: "How do I update Pitflix?",
                  a: "Go to Settings → App & Updates. If an update is available from GitHub, you'll see a download button. On Windows the updater can apply the update automatically. You can also check manually by clicking \"Check for updates\".",
                },
                {
                  q: "SubDL returns 'too many requests'. What do I do?",
                  a: "SubDL's free API has a rate limit. Pitflix automatically retries once after a short delay when a 429 response is received. If searches still fail, wait a minute and try again, or upgrade your SubDL plan for a higher quota.",
                },
                {
                  q: "How do I watch a specific episode from the Awards page?",
                  a: "On an award nominee card, click Stream to go directly to the streaming detail page for that series. From there, click on the season you want to open the season page, then click the Play button next to any episode.",
                },
              ] as { q: string; a: string }[]).map(({ q, a }, i) => (
                <div key={i} className="rounded-xl border border-transparent px-3 py-3.5 transition-colors hover:border-white/[0.06] hover:bg-white/[0.03] border-b-[0px]">
                  <div className="border-b border-white/[0.05] pb-3.5 last:border-0 last:pb-0">
                    <p className="text-sm font-semibold text-white">{q}</p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-pitflix-subtle">{a}</p>
                  </div>
                </div>
              ))}
              </div>
            </div>
          </section>
  );
}

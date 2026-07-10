"""One-off diagnostic: log a single known episode and print Serializd's RAW response body,
instead of trusting serializd-py's is_success-only check. Friends S1E1, tmdb:1668."""
import json
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

from serializd import SerializdClient
import httpx

cache_dir = Path(r"C:\Users\Abd Allah\Downloads\Telegram Desktop\gdpr-data\_import_cache")
token = json.loads((cache_dir / "serializd_token.json").read_text(encoding="utf-8"))["token"]

client = SerializdClient()
client.session = httpx.Client(base_url=client.session.base_url, headers=client.session.headers,
                               timeout=httpx.Timeout(30.0, connect=10.0))
client.load_token(token, check=False)

season = client.get_season(show_id=1668, season_number=1)
print(f"season_id={season.seasonId}, episodes on TMDB/Serializd: {len(season.episodes)}")

resp = client.session.post(
    "/episode_log/add",
    json={"episode_numbers": [1], "season_id": season.seasonId, "show_id": 1668, "should_get_next_episode": False},
)
print("STATUS:", resp.status_code)
print("BODY:", resp.text)

# Now replicate exactly what the importer does: log the FULL season in one call.
resp2 = client.session.post(
    "/episode_log/add",
    json={"episode_numbers": list(range(1, 25)), "season_id": season.seasonId, "show_id": 1668,
          "should_get_next_episode": False},
)
print("\nFULL SEASON STATUS:", resp2.status_code)
print("FULL SEASON BODY:", resp2.text)

# Check the RAW season response for fields serializd-py's pydantic model might silently drop
raw = client.session.get(f"/show/1668/season/1")
print("\nRAW SEASON RESPONSE KEYS:", list(raw.json().keys()))
print(json.dumps(raw.json(), indent=2)[:3000])

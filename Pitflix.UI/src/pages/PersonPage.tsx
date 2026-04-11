import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { getPerson } from "../api/people";
import { MediaImage } from "../components/ui/MediaImage";
import { Spinner } from "../components/ui/Spinner";

type LocalAppearance = {
  mediaKind: string;
  databaseId: number;
  posterLocalPath?: string | null;
  title?: string;
  year?: number | null;
};

export function PersonPage() {
  const { tmdbId } = useParams();
  const navigate = useNavigate();
  const id = Number(tmdbId);
  const { data, isLoading } = useQuery({
    queryKey: ["person", id],
    queryFn: () => getPerson(id),
    enabled: Number.isFinite(id) && id > 0,
  });

  if (!Number.isFinite(id) || id <= 0) return <p className="text-pitflix-muted">Invalid person</p>;
  if (isLoading)
    return (
      <div className="flex justify-center py-24">
        <Spinner />
      </div>
    );

  const person = data?.person as {
    name?: string;
    biography?: string;
    profileImageUrl?: string | null;
    birthday?: string | null;
    placeOfBirth?: string | null;
  } | null;

  const localAppearances = (data?.localAppearances ?? []) as LocalAppearance[];

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 text-sm text-pitflix-muted hover:text-white"
      >
        ← Back
      </button>
      <div className="flex flex-wrap gap-8">
        <MediaImage
          src={person?.profileImageUrl ?? undefined}
          alt={person?.name ?? ""}
          className="h-48 w-48 shrink-0 overflow-hidden rounded-full bg-pitflix-card object-cover object-top"
          fallbackText={person?.name?.slice(0, 3) ?? "?"}
        />
        <div className="min-w-0 flex-1">
          <h1 className="mb-1 text-3xl font-bold text-white">{person?.name ?? "Person"}</h1>
          {person?.birthday || person?.placeOfBirth ? (
            <p className="mb-3 text-sm text-pitflix-muted">
              {[person.birthday, person.placeOfBirth].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          <p className="max-w-3xl text-sm leading-relaxed text-pitflix-muted">{person?.biography}</p>
        </div>
      </div>

      {localAppearances.length > 0 ? (
        <div className="mt-10">
          <h2 className="mb-4 text-xl font-bold text-white">In your library</h2>
          <div className="flex flex-wrap gap-4">
            {localAppearances.map((item) => {
              const kind = (item.mediaKind || "").toLowerCase();
              const href = kind === "series" ? `/series/${item.databaseId}` : `/movie/${item.databaseId}`;
              return (
                <button
                  key={`${item.databaseId}-${item.mediaKind}`}
                  type="button"
                  onClick={() => navigate(href)}
                  className="cursor-pointer group text-left"
                >
                  <div className="w-32 overflow-hidden rounded-lg transition-all group-hover:ring-2 group-hover:ring-pitflix-primary">
                    <img
                      src={item.posterLocalPath ?? ""}
                      alt={item.title ?? ""}
                      className="aspect-[2/3] w-full object-cover"
                      onError={(e) => {
                        e.currentTarget.src = "";
                        e.currentTarget.className = "hidden";
                      }}
                    />
                  </div>
                  <p className="mt-2 w-32 truncate text-center text-xs font-medium text-white">{item.title}</p>
                  {item.year != null ? (
                    <p className="text-center text-xs text-pitflix-muted">{item.year}</p>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="mt-10">
          <h2 className="mb-2 text-xl font-bold text-white">In your library</h2>
          <p className="text-sm text-pitflix-muted">Not found in your local library.</p>
        </div>
      )}
    </div>
  );
}

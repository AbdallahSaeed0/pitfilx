import '../models/actor.dart';
import '../models/episode.dart';
import '../models/season.dart';
import '../models/title_item.dart';

/// Placeholder/mock data — no backend wiring. Poster/backdrop images are
/// represented with gradientSeed indices (see PosterCard) standing in for
/// TMDB imagery, per the design handoff.
class MockData {
  MockData._();

  static List<Season> _severanceSeasons() {
    Episode ep(int n, String t, int d, bool w) =>
        Episode(number: n, title: t, durationMinutes: d, watched: w);
    return [
      Season(
        number: 1,
        name: 'Season 1',
        episodes: List.generate(
          9,
          (i) => ep(i + 1, 'Episode ${i + 1}', 50, true),
        ),
      ),
      Season(
        number: 2,
        name: 'Season 2',
        episodes: [
          ep(1, 'Cold Harbor', 52, true),
          ep(2, 'Goodbye, Mrs. Selvig', 46, true),
          ep(3, 'Who Is Alive?', 55, true),
          ep(4, "Woe's Hollow", 48, true),
          ep(5, "Trojan's Horse", 51, true),
          ep(6, 'Attila', 49, true),
          ep(7, 'Chikhai Bardo', 53, true),
          ep(8, 'Sweet Vitriol', 41, true),
          ep(9, 'The Goodbye Party', 42, false),
        ],
      ),
    ];
  }

  static final actors = <Actor>[
    const Actor(
      id: 'pedro-pascal',
      name: 'Pedro Pascal',
      initials: 'PP',
      birthDate: 'April 2, 1975',
      birthPlace: 'Santiago, Chile',
      bio:
          'Chilean-American actor known for his roles in Game of Thrones, '
          'Narcos, The Mandalorian, and The Last of Us. One of the most '
          'in-demand leading men in Hollywood.',
      filmographyTitleIds: [
        'the-mandalorian',
        'the-last-of-us',
        'narcos',
        'gladiator-ii',
        'game-of-thrones',
        'the-unbearable-weight',
      ],
      gradientSeed: [0, 1],
    ),
    const Actor(
      id: 'timothee-chalamet',
      name: 'Timothée Chalamet',
      initials: 'TC',
      birthDate: 'December 27, 1995',
      birthPlace: 'New York City, USA',
      bio:
          'American-French actor acclaimed for Call Me by Your Name, Dune, '
          'and Wonka. Youngest Best Actor Oscar nominee of the sound era.',
      filmographyTitleIds: ['dune-part-two'],
      gradientSeed: [2, 3],
    ),
    const Actor(
      id: 'zendaya',
      name: 'Zendaya',
      initials: 'ZD',
      birthDate: 'September 1, 1996',
      birthPlace: 'Oakland, California, USA',
      bio:
          'American actress and singer known for Euphoria and the Dune '
          'saga. Emmy winner for Outstanding Lead Actress in a Drama Series.',
      filmographyTitleIds: ['dune-part-two'],
      gradientSeed: [4, 5],
    ),
    const Actor(
      id: 'rebecca-ferguson',
      name: 'Rebecca Ferguson',
      initials: 'RF',
      birthDate: 'October 19, 1983',
      birthPlace: 'Stockholm, Sweden',
      bio:
          'Swedish actress known for the Mission: Impossible franchise and '
          'her role as Lady Jessica in the Dune films.',
      filmographyTitleIds: ['dune-part-two'],
      gradientSeed: [1, 2],
    ),
    const Actor(
      id: 'austin-butler',
      name: 'Austin Butler',
      initials: 'AB',
      birthDate: 'August 17, 1991',
      birthPlace: 'Anaheim, California, USA',
      bio:
          'American actor who rose to prominence playing Elvis Presley, '
          'earning an Academy Award nomination for Best Actor.',
      filmographyTitleIds: ['dune-part-two'],
      gradientSeed: [3, 0],
    ),
    const Actor(
      id: 'josh-brolin',
      name: 'Josh Brolin',
      initials: 'JB',
      birthDate: 'February 12, 1968',
      birthPlace: 'Santa Monica, California, USA',
      bio:
          'American actor known for No Country for Old Men, the MCU\'s '
          'Thanos, and Dune.',
      filmographyTitleIds: ['dune-part-two'],
      gradientSeed: [5, 4],
    ),
  ];

  static final titles = <TitleItem>[
    TitleItem(
      id: 'severance',
      name: 'Severance',
      kind: TitleKind.show,
      year: 2022,
      network: 'Apple TV+',
      rating: 8.7,
      genres: const ['Drama', 'Mystery', 'Sci-Fi'],
      overview:
          'Mark leads a team at Lumon Industries whose employees have had '
          'their memories surgically divided between work and personal '
          'lives. When a mysterious colleague appears outside of work, it '
          'begins a journey to discover the truth about their jobs.',
      castActorIds: const ['pedro-pascal'],
      gradientSeed: 0,
      seasons: _severanceSeasons(),
      continueEpisodeLabel: 'S2 E9 · The Goodbye Party',
      continueEpisodeSub: '42 min',
      episodeSub: 'S2 · E9',
      progress: 0.62,
    ),
    TitleItem(
      id: 'the-last-of-us',
      name: 'The Last of Us',
      kind: TitleKind.show,
      year: 2023,
      network: 'HBO Max',
      rating: 8.6,
      genres: const ['Drama', 'Horror', 'Thriller'],
      overview:
          'Joel and Ellie, a pair connected through the harshness of a '
          'world ravaged by infection, are forced to endure brutal '
          'circumstances and dangerous foes on their journey across a '
          'post-pandemic United States.',
      castActorIds: const ['pedro-pascal'],
      gradientSeed: 1,
      seasons: [
        Season(
          number: 1,
          name: 'Season 1',
          episodes: List.generate(
            9,
            (i) => Episode(
              number: i + 1,
              title: 'Episode ${i + 1}',
              durationMinutes: 55,
              watched: true,
            ),
          ),
        ),
        Season(
          number: 2,
          name: 'Season 2',
          episodes: List.generate(
            7,
            (i) => Episode(
              number: i + 1,
              title: 'Episode ${i + 1}',
              durationMinutes: 50,
              watched: i < 3,
            ),
          ),
        ),
      ],
      continueEpisodeLabel: 'S2 E3 · The Path',
      continueEpisodeSub: '48 min',
      episodeSub: 'S2 · E3',
      progress: 0.35,
    ),
    TitleItem(
      id: 'dune-prophecy',
      name: 'Dune: Prophecy',
      kind: TitleKind.show,
      year: 2024,
      network: 'HBO Max',
      rating: 7.4,
      genres: const ['Sci-Fi', 'Drama'],
      overview:
          'Two Harkonnen sisters combat forces that threaten the future of '
          'humankind, and establish the Bene Gesserit, in this original '
          'series set 10,000 years before the ascension of Paul Atreides.',
      gradientSeed: 2,
      seasons: [
        Season(
          number: 1,
          name: 'Season 1',
          episodes: List.generate(
            6,
            (i) => Episode(
              number: i + 1,
              title: 'Episode ${i + 1}',
              durationMinutes: 58,
              watched: i < 5,
            ),
          ),
        ),
      ],
      continueEpisodeLabel: 'S1 E5 · Twice Born',
      continueEpisodeSub: '58 min',
      episodeSub: 'S1 · E5',
      progress: 0.83,
    ),
    TitleItem(
      id: 'house-of-the-dragon',
      name: 'House of the Dragon',
      kind: TitleKind.show,
      year: 2022,
      network: 'HBO Max',
      rating: 8.4,
      genres: const ['Drama', 'Fantasy', 'Action'],
      overview:
          'The Targaryen dynasty is at the absolute apex of its power, '
          'with more than 15 dragons under their yoke. The decisions that '
          'plunge the Targaryens into a war between family members.',
      gradientSeed: 3,
    ),
    const TitleItem(
      id: 'andor',
      name: 'Andor',
      kind: TitleKind.show,
      year: 2022,
      network: 'Disney+',
      rating: 8.4,
      genres: ['Sci-Fi', 'Drama', 'Action'],
      overview:
          'In the era of the Empire\'s ascension, Cassian Andor\'s path '
          'towards rebellion begins.',
      gradientSeed: 4,
    ),
    const TitleItem(
      id: 'the-bear',
      name: 'The Bear',
      kind: TitleKind.show,
      year: 2022,
      network: 'FX',
      rating: 8.6,
      genres: ['Comedy', 'Drama'],
      overview:
          'A young chef from the fine dining world returns home to '
          'Chicago to run his family sandwich shop after a heartbreaking '
          'death in his family.',
      gradientSeed: 5,
    ),
    const TitleItem(
      id: 'slow-horses',
      name: 'Slow Horses',
      kind: TitleKind.show,
      year: 2022,
      network: 'Apple TV+',
      rating: 8.3,
      genres: ['Drama', 'Thriller', 'Comedy'],
      overview:
          'In London, a dumping ground exists within the MI5 for disgraced '
          'spies. Under the command of the notoriously irascible Jackson '
          'Lamb, these washed-up spies work to redeem themselves.',
      gradientSeed: 0,
    ),
    const TitleItem(
      id: 'silo',
      name: 'Silo',
      kind: TitleKind.show,
      year: 2023,
      network: 'Apple TV+',
      rating: 8.0,
      genres: ['Sci-Fi', 'Mystery', 'Drama'],
      overview:
          'In a ruined and toxic future, a community exists in a giant '
          'underground silo that stretches hundreds of stories down.',
      gradientSeed: 1,
    ),
    const TitleItem(
      id: 'the-penguin',
      name: 'The Penguin',
      kind: TitleKind.show,
      year: 2024,
      network: 'HBO Max',
      rating: 8.5,
      genres: ['Crime', 'Drama'],
      overview:
          'In the aftermath of the Riddler\'s reign of chaos, Oz Cobb '
          'seizes an opportunity to rise to power in a Gotham City fractured '
          'by corruption.',
      gradientSeed: 2,
    ),
    TitleItem(
      id: 'breaking-bad',
      name: 'Breaking Bad',
      kind: TitleKind.show,
      year: 2008,
      network: 'AMC',
      rating: 9.5,
      genres: const ['Crime', 'Drama', 'Thriller'],
      overview:
          'A chemistry teacher diagnosed with terminal lung cancer teams '
          'with a former student to secure his family\'s future by '
          'manufacturing and selling crystal meth.',
      gradientSeed: 3,
      seasons: [
        Season(
          number: 1,
          name: 'Season 1',
          episodes: List.generate(
            7,
            (i) => Episode(
              number: i + 1,
              title: 'Episode ${i + 1}',
              durationMinutes: 47,
              watched: true,
            ),
          ),
        ),
      ],
    ),
    const TitleItem(
      id: 'the-wire',
      name: 'The Wire',
      kind: TitleKind.show,
      year: 2002,
      network: 'HBO Max',
      rating: 9.3,
      genres: ['Crime', 'Drama'],
      overview:
          'The Baltimore drug scene, as seen through the eyes of drug '
          'dealers and law enforcement.',
      gradientSeed: 4,
    ),
    const TitleItem(
      id: 'succession',
      name: 'Succession',
      kind: TitleKind.show,
      year: 2018,
      network: 'HBO Max',
      rating: 8.9,
      genres: ['Drama'],
      overview:
          'The Roy family controls the biggest media and entertainment '
          'company in the world, and their four children fight for '
          'control of the company amid uncertainty about their aging '
          'father\'s health.',
      gradientSeed: 5,
    ),
    const TitleItem(
      id: 'game-of-thrones',
      name: 'Game of Thrones',
      kind: TitleKind.show,
      year: 2011,
      network: 'HBO Max',
      rating: 9.2,
      genres: ['Drama', 'Fantasy', 'Action'],
      overview:
          'Nine noble families fight for control over the mythical lands '
          'of Westeros, while an ancient enemy returns after being dormant '
          'for millennia.',
      castActorIds: ['pedro-pascal'],
      gradientSeed: 0,
    ),
    TitleItem(
      id: 'dune-part-two',
      name: 'Dune: Part Two',
      kind: TitleKind.movie,
      year: 2024,
      network: 'Theaters',
      rating: 8.5,
      genres: const ['Sci-Fi', 'Adventure', 'Drama'],
      overview:
          'Paul Atreides unites with the Fremen to wage war against the '
          'Harkonnens and seeks revenge against the conspirators who '
          'destroyed his family.',
      castActorIds: const [
        'timothee-chalamet',
        'zendaya',
        'rebecca-ferguson',
        'austin-butler',
        'josh-brolin',
      ],
      gradientSeed: 3,
      runtimeLabel: '2h 46m',
      watched: true,
      userRating: 4,
      watchLater: false,
    ),
    const TitleItem(
      id: 'gladiator-ii',
      name: 'Gladiator II',
      kind: TitleKind.movie,
      year: 2024,
      network: 'Theaters',
      rating: 6.7,
      genres: ['Action', 'Drama'],
      overview:
          'Years after witnessing the death of Maximus at the hands of his '
          'uncle, Lucius is forced to enter the Colosseum after his home is '
          'conquered by tyrannical Roman Emperors.',
      castActorIds: ['pedro-pascal'],
      gradientSeed: 1,
      runtimeLabel: '2h 28m',
    ),
    const TitleItem(
      id: 'the-unbearable-weight',
      name: 'The Unbearable Weight of Massive Talent',
      kind: TitleKind.movie,
      year: 2022,
      network: 'Theaters',
      rating: 7.1,
      genres: ['Comedy', 'Action'],
      overview:
          'A fictionalized version of Nicolas Cage must accept a job from '
          'a superfan while his career and family fall apart around him.',
      castActorIds: ['pedro-pascal'],
      gradientSeed: 2,
      runtimeLabel: '1h 47m',
    ),
    const TitleItem(
      id: 'blade-runner-2049',
      name: 'Blade Runner 2049',
      kind: TitleKind.movie,
      year: 2017,
      network: 'Theaters',
      rating: 8.0,
      genres: ['Sci-Fi', 'Drama', 'Mystery'],
      overview:
          'Young Blade Runner K\'s discovery of a long-buried secret leads '
          'him to track down former Blade Runner Rick Deckard, who\'s been '
          'missing for thirty years.',
      gradientSeed: 4,
      runtimeLabel: '2h 44m',
    ),
    const TitleItem(
      id: 'blade-runner',
      name: 'Blade Runner',
      kind: TitleKind.movie,
      year: 1982,
      network: 'Theaters',
      rating: 8.1,
      genres: ['Sci-Fi', 'Drama'],
      overview:
          'A blade runner must pursue and terminate four replicants who '
          'stole a ship in space and returned to Earth to find their '
          'creator.',
      gradientSeed: 5,
      runtimeLabel: '1h 57m',
    ),
    const TitleItem(
      id: 'br-black-lotus',
      name: 'BR: Black Lotus',
      kind: TitleKind.show,
      year: 2021,
      network: 'Adult Swim',
      rating: 7.2,
      genres: ['Sci-Fi', 'Animation', 'Action'],
      overview:
          'A young woman fights to recover her memories and take revenge '
          'on those who tried to have her killed in Los Angeles, 2032.',
      gradientSeed: 0,
    ),
    const TitleItem(
      id: 'blade-runner-2022',
      name: 'Blade Runner 2022',
      kind: TitleKind.movie,
      year: 2022,
      network: 'Theaters',
      rating: 6.4,
      genres: ['Sci-Fi', 'Animation'],
      overview:
          'An anime prequel bridging the story of the two live-action films.',
      gradientSeed: 1,
      runtimeLabel: '1h 4m',
    ),
    const TitleItem(
      id: 'narcos',
      name: 'Narcos',
      kind: TitleKind.show,
      year: 2015,
      network: 'Netflix',
      rating: 8.8,
      genres: ['Crime', 'Drama', 'Biography'],
      overview:
          'A chronicled look at the criminal exploits of Colombian drug '
          'lord Pablo Escobar, as well as the many other drug kingpins who '
          'plagued the country through the years.',
      castActorIds: ['pedro-pascal'],
      gradientSeed: 2,
    ),
    const TitleItem(
      id: 'the-mandalorian',
      name: 'The Mandalorian',
      kind: TitleKind.show,
      year: 2019,
      network: 'Disney+',
      rating: 8.6,
      genres: ['Sci-Fi', 'Action', 'Adventure'],
      overview:
          'The travels of a lone bounty hunter in the outer reaches of the '
          'galaxy, far from the authority of the New Republic.',
      castActorIds: ['pedro-pascal'],
      gradientSeed: 3,
    ),
  ];

  static TitleItem byId(String id) => titles.firstWhere((t) => t.id == id);

  static List<TitleItem> byIds(List<String> ids) =>
      ids.map(byId).toList(growable: false);

  static Actor actorById(String id) => actors.firstWhere((a) => a.id == id);

  static List<TitleItem> get watchNextShows =>
      byIds(['severance', 'the-last-of-us', 'dune-prophecy']);

  static List<TitleItem> get trendingShows =>
      byIds(['house-of-the-dragon', 'andor', 'the-bear', 'silo']);

  static List<TitleItem> get watchLaterShows =>
      byIds(['slow-horses', 'silo', 'the-penguin', 'andor']);

  static List<TitleItem> get trendingMovies =>
      byIds(['dune-part-two', 'gladiator-ii', 'blade-runner-2049']);

  static List<TitleItem> get watchLaterMovies =>
      byIds(['the-unbearable-weight', 'blade-runner', 'blade-runner-2022']);

  // ---- Profile quick-stat mock data (Stats screen itself is wired to real
  // Supabase watch_events data now — see stats_screen.dart) ----

  static const totalEpisodesWatched = 5920;

  // ---- Profile mock data ----
  static const userName = 'John Doe';
  static const userInitials = 'JD';
  static const userEmail = 'john@example.com';
  static const tvTimeLabel = '5mo 21d';
}

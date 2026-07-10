import '../models/activity_item.dart';
import '../models/friend.dart';
import '../models/friend_request.dart';

/// Mock friends/requests/activity — see friend.dart for why this is
/// placeholder data rather than something wired to a backend.
abstract class MockFriendsData {
  static final friends = <Friend>[
    const Friend(
      id: 'sarah-kim',
      name: 'Sarah Kim',
      username: '@sarahk',
      gradientSeed: 0,
      isOnline: true,
      tvTimeLabel: '3mo 12d',
      totalEpisodesWatched: 2140,
      totalMoviesWatched: 186,
      currentlyWatching: 'The Bear · S3 E4',
      recentTitleIds: ['the-bear', 'severance', 'silo'],
      watchLaterTitleIds: ['andor', 'the-penguin'],
    ),
    const Friend(
      id: 'mike-torres',
      name: 'Mike Torres',
      username: '@miket',
      gradientSeed: 1,
      isOnline: false,
      tvTimeLabel: '1yr 2mo',
      totalEpisodesWatched: 5310,
      totalMoviesWatched: 412,
      currentlyWatching: 'Breaking Bad · S1 E5',
      recentTitleIds: ['breaking-bad', 'the-wire', 'succession'],
      watchLaterTitleIds: ['the-mandalorian'],
    ),
    const Friend(
      id: 'priya-nair',
      name: 'Priya Nair',
      username: '@priyan',
      gradientSeed: 2,
      isOnline: true,
      tvTimeLabel: '7mo 4d',
      totalEpisodesWatched: 3480,
      totalMoviesWatched: 264,
      currentlyWatching: 'House of the Dragon · S2 E6',
      recentTitleIds: ['house-of-the-dragon', 'game-of-thrones', 'andor'],
      watchLaterTitleIds: ['dune-prophecy', 'silo'],
    ),
    const Friend(
      id: 'diego-alvarez',
      name: 'Diego Alvarez',
      username: '@diegoa',
      gradientSeed: 3,
      isOnline: false,
      tvTimeLabel: '5mo 18d',
      totalEpisodesWatched: 1890,
      totalMoviesWatched: 138,
      recentTitleIds: ['narcos', 'the-last-of-us'],
      watchLaterTitleIds: ['the-penguin', 'succession'],
    ),
    const Friend(
      id: 'emma-clarke',
      name: 'Emma Clarke',
      username: '@emmac',
      gradientSeed: 4,
      isOnline: true,
      tvTimeLabel: '2yr 1mo',
      totalEpisodesWatched: 8120,
      totalMoviesWatched: 590,
      currentlyWatching: 'Slow Horses · S4 E2',
      recentTitleIds: ['slow-horses', 'silo', 'the-bear'],
      watchLaterTitleIds: ['blade-runner-2049'],
    ),
    const Friend(
      id: 'jordan-lee',
      name: 'Jordan Lee',
      username: '@jlee',
      gradientSeed: 5,
      isOnline: false,
      tvTimeLabel: '4mo 9d',
      totalEpisodesWatched: 1420,
      totalMoviesWatched: 97,
      recentTitleIds: ['the-mandalorian', 'game-of-thrones'],
      watchLaterTitleIds: ['dune-part-two'],
    ),
  ];

  static Friend get _requestPending1 => const Friend(
    id: 'alex-morgan',
    name: 'Alex Morgan',
    username: '@alexm',
    gradientSeed: 2,
    tvTimeLabel: '6mo 2d',
    totalEpisodesWatched: 2760,
    recentTitleIds: ['succession', 'the-wire'],
  );

  static Friend get _requestPending2 => const Friend(
    id: 'nina-brooks',
    name: 'Nina Brooks',
    username: '@ninab',
    gradientSeed: 4,
    tvTimeLabel: '1mo 20d',
    totalEpisodesWatched: 540,
    recentTitleIds: ['silo'],
  );

  static Friend get _requestPending3 => const Friend(
    id: 'carlos-mendez',
    name: 'Carlos Mendez',
    username: '@carlosm',
    gradientSeed: 1,
    tvTimeLabel: '9mo 15d',
    totalEpisodesWatched: 4020,
    recentTitleIds: ['breaking-bad'],
  );

  static List<FriendRequest> get incomingRequests => [
    FriendRequest(
      id: 'req-1',
      friend: _requestPending1,
      direction: FriendRequestDirection.incoming,
      sentAt: DateTime.now().subtract(const Duration(hours: 5)),
    ),
    FriendRequest(
      id: 'req-2',
      friend: _requestPending2,
      direction: FriendRequestDirection.incoming,
      sentAt: DateTime.now().subtract(const Duration(days: 2)),
    ),
  ];

  static List<FriendRequest> get outgoingRequests => [
    FriendRequest(
      id: 'req-3',
      friend: _requestPending3,
      direction: FriendRequestDirection.outgoing,
      sentAt: DateTime.now().subtract(const Duration(days: 1)),
    ),
  ];

  /// A wider directory to search over on the Add Friend screen — includes
  /// existing friends, pending requests, and a few standalone strangers.
  static List<Friend> get directory => [
    ...friends,
    _requestPending1,
    _requestPending2,
    _requestPending3,
    const Friend(
      id: 'olivia-park',
      name: 'Olivia Park',
      username: '@oliviap',
      gradientSeed: 3,
      tvTimeLabel: '11mo 6d',
      totalEpisodesWatched: 3900,
      recentTitleIds: ['dune-prophecy'],
    ),
    const Friend(
      id: 'sam-whitfield',
      name: 'Sam Whitfield',
      username: '@samw',
      gradientSeed: 5,
      tvTimeLabel: '2mo 3d',
      totalEpisodesWatched: 780,
      recentTitleIds: ['the-penguin'],
    ),
  ];

  static List<ActivityItem> get activity => [
    ActivityItem(
      id: 'act-1',
      friend: friends[0],
      titleId: 'the-bear',
      action: ActivityAction.watched,
      timestamp: DateTime.now().subtract(const Duration(hours: 2)),
    ),
    ActivityItem(
      id: 'act-2',
      friend: friends[2],
      titleId: 'house-of-the-dragon',
      action: ActivityAction.rated,
      rating: 5,
      timestamp: DateTime.now().subtract(const Duration(hours: 6)),
    ),
    ActivityItem(
      id: 'act-3',
      friend: friends[4],
      titleId: 'slow-horses',
      action: ActivityAction.watched,
      timestamp: DateTime.now().subtract(const Duration(hours: 9)),
    ),
    ActivityItem(
      id: 'act-4',
      friend: friends[1],
      titleId: 'breaking-bad',
      action: ActivityAction.addedToWatchLater,
      timestamp: DateTime.now().subtract(const Duration(days: 1, hours: 3)),
    ),
    ActivityItem(
      id: 'act-5',
      friend: friends[3],
      titleId: 'narcos',
      action: ActivityAction.rated,
      rating: 4,
      timestamp: DateTime.now().subtract(const Duration(days: 1, hours: 10)),
    ),
    ActivityItem(
      id: 'act-6',
      friend: friends[5],
      titleId: 'the-mandalorian',
      action: ActivityAction.watched,
      timestamp: DateTime.now().subtract(const Duration(days: 2)),
    ),
    ActivityItem(
      id: 'act-7',
      friend: friends[2],
      titleId: 'andor',
      action: ActivityAction.addedToWatchLater,
      timestamp: DateTime.now().subtract(const Duration(days: 3)),
    ),
    ActivityItem(
      id: 'act-8',
      friend: friends[0],
      titleId: 'silo',
      action: ActivityAction.rated,
      rating: 5,
      timestamp: DateTime.now().subtract(const Duration(days: 4)),
    ),
  ];
}

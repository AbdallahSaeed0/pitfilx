import 'package:http/http.dart' as http;

/// One shared HTTP client for the app's outbound calls.
///
/// package:http's top-level helpers (`http.get(...)`) open a brand-new [http.Client] per call and
/// close it as soon as the response lands — the package's own docs say to use a single client when
/// making repeated requests to the same server. Every TMDB call was therefore paying a full TCP +
/// TLS handshake before it could send a byte: ~109 ms of pure overhead per request measured against
/// api.themoviedb.org on a wired desktop connection, and materially worse on mobile where round
/// trips are slower and TLS costs two of them.
///
/// Home alone fires a dozen-plus TMDB requests on a cold load, so that overhead was seconds of
/// nothing-on-screen. A shared client keeps the connection alive and lets subsequent requests skip
/// straight to sending.
class PitflixHttp {
  PitflixHttp._();

  static final http.Client client = http.Client();
}

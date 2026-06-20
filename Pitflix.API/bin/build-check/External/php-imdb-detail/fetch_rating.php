<?php
/**
 * Minimal IMDb rating fetcher (php-imdb-detail style): HTML + JSON-LD parse.
 * Usage: php fetch_rating.php tt1234567
 * Stdout: JSON { "rating":"8.4","votes":"123456","source":"php-imdb-detail" } or { "error":"..." }
 */
declare(strict_types=1);

$imdbId = $argv[1] ?? '';
if (!preg_match('/^tt\d+$/', $imdbId)) {
    fwrite(STDERR, "bad_imdb_id\n");
    echo json_encode(['error' => 'bad_imdb_id']);
    exit(1);
}

$url = 'https://www.imdb.com/title/' . rawurlencode($imdbId) . '/';
$ctx = stream_context_create([
    'http' => [
        'timeout' => 14,
        'header' => "User-Agent: Mozilla/5.0 (Windows NT 10.0; rv:109.0) Gecko/20100101 Firefox/115.0\r\nAccept-Language: en-US,en;q=0.9\r\n",
        'follow_location' => 1,
    ],
]);

$html = @file_get_contents($url, false, $ctx);
if ($html === false || $html === '') {
    echo json_encode(['error' => 'fetch_failed']);
    exit(2);
}

$rating = null;
$votes = null;

// JSON-LD aggregateRating (common on IMDb title pages)
if (preg_match('/"aggregateRating"\s*:\s*\{[^}]*"ratingValue"\s*:\s*([\d.]+)[^}]*"ratingCount"\s*:\s*(\d+)/s', $html, $m)) {
    $rating = $m[1];
    $votes = $m[2];
} elseif (preg_match('/"ratingValue"\s*:\s*([\d.]+).*?"ratingCount"\s*:\s*(\d+)/s', $html, $m)) {
    $rating = $m[1];
    $votes = $m[2];
}

if ($rating === null && preg_match('/data-testid="hero-rating-bar__aggregate-rating__score"[^>]*>\s*<span[^>]*>([\d.]+)</s', $html, $m)) {
    $rating = $m[1];
}

if ($rating === null) {
    echo json_encode(['error' => 'parse_failed']);
    exit(3);
}

echo json_encode([
    'rating' => $rating,
    'votes' => $votes,
    'source' => 'php-imdb-detail',
], JSON_UNESCAPED_SLASHES);

/// Formats a minute count as a compact human label ("42m", "3h 5m", "2d 4h",
/// "5 mo 3 d") — shared by Stats and Profile's quick stats.
String formatMinutes(int minutes) {
  if (minutes < 60) return '${minutes}m';
  final hours = minutes ~/ 60;
  final mins = minutes % 60;
  if (hours < 24) return mins > 0 ? '${hours}h ${mins}m' : '${hours}h';
  final days = hours ~/ 24;
  final remHours = hours % 24;
  if (days < 30) return remHours > 0 ? '${days}d ${remHours}h' : '${days}d';
  final months = days ~/ 30;
  final remDays = days % 30;
  return remDays > 0 ? '$months mo $remDays d' : '$months mo';
}

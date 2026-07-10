class Actor {
  final String id;
  final String name;
  final String initials;
  final String birthDate;
  final String birthPlace;
  final String bio;
  final List<String> filmographyTitleIds;
  final List<int> gradientSeed;

  const Actor({
    required this.id,
    required this.name,
    required this.initials,
    required this.birthDate,
    required this.birthPlace,
    required this.bio,
    required this.filmographyTitleIds,
    this.gradientSeed = const [0, 1],
  });
}

using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;

namespace PitflixPlayer;

public partial class SubtitleSearchOverlay : Window
{
    private readonly MpvIpcClient _ipc;
    private readonly string       _videoFilePath;
    private readonly int          _mediaId;
    private readonly int?         _episodeId;
    private readonly string?      _passedImdbId;

    private string  _mediaType     = "movie";
    private int?    _tmdbId;
    private int?    _parentTmdbId;
    private int?    _season;
    private int?    _episodeNumber;
    private string? _imdbId;

    private enum ProviderTab { OpenSubtitles, SubDl, SubSource }

    private List<OsSubtitleRow>        _osResults        = [];
    private List<SubDlSubtitleRow>     _subDlResults     = [];
    private List<SubSourceSubtitleRow> _subSourceResults = [];
    private ProviderTab             _activeTab    = ProviderTab.OpenSubtitles;
    private bool                    _isSearching;
    private bool                    _isClosing;
    private CancellationTokenSource _cts = new();

    private static readonly SolidColorBrush AccentBrush = new(Color.FromRgb(0x7C, 0x3A, 0xED));
    private static readonly SolidColorBrush RowBrush    = new(Color.FromRgb(0x1A, 0x1A, 0x1A));
    private static readonly SolidColorBrush MutedBrush  = new(Color.FromRgb(0x9C, 0xA3, 0xAF));

    internal SubtitleSearchOverlay(
        Window owner,
        MpvIpcClient ipc,
        string currentTitle,
        string? imdbId,
        int? episodeId,
        int mediaId,
        string videoFilePath)
    {
        InitializeComponent();

        Owner          = owner;
        _ipc           = ipc;
        _passedImdbId  = imdbId;
        _episodeId     = episodeId;
        _mediaId       = mediaId;
        _videoFilePath = videoFilePath;

        SearchBox.Text = currentTitle;

        LanguageCombo.Items.Add(new ComboBoxItem { Content = "Any",      Tag = "" });
        LanguageCombo.Items.Add(new ComboBoxItem { Content = "English",  Tag = "en" });
        LanguageCombo.Items.Add(new ComboBoxItem { Content = "Arabic",   Tag = "ar" });
        LanguageCombo.SelectedIndex = 0;

        UpdateTabStyles();
        CenterOverOwner();

        Loaded += OnOverlayLoaded;
        Closed += OnOverlayClosed;
        if (owner is not null)
            owner.LocationChanged += (_, _) => CenterOverOwner();
    }

    private void CenterOverOwner()
    {
        if (Owner is null) return;
        Left = Owner.Left + (Owner.ActualWidth  > 0 ? Owner.ActualWidth  : Owner.Width  - Width)  / 2;
        Top  = Owner.Top  + (Owner.ActualHeight > 0 ? Owner.ActualHeight : Owner.Height - Height) / 2;
    }

    private async void OnOverlayLoaded(object sender, RoutedEventArgs e)
    {
        _ = _ipc.SendAsync("set_property", "pause", true);
        await ResolveSearchContextAsync().ConfigureAwait(true);
        await RunSearchAsync().ConfigureAwait(true);
    }

    private void OnOverlayClosed(object? sender, EventArgs e)
    {
        if (!_isClosing) ResumePlayback();
        _cts.Cancel();
        _cts.Dispose();
    }

    private void ResumePlayback()
    {
        _ = _ipc.SendAsync("set_property", "pause", false);
    }

    private async Task ResolveSearchContextAsync()
    {
        try
        {
            var resolve = await SubtitleApiClient.ResolveByPathAsync(_videoFilePath, _cts.Token)
                .ConfigureAwait(true);

            if (resolve is not null &&
                string.Equals(resolve.MediaType, "Series", StringComparison.OrdinalIgnoreCase))
            {
                _mediaType     = "episode";
                _season        = resolve.Season;
                _episodeNumber = resolve.EpisodeNumber;
                if (resolve.LibraryShowId is int showId)
                    _parentTmdbId = await SubtitleApiClient.GetShowTmdbIdAsync(showId, _cts.Token)
                        .ConfigureAwait(true);
            }
            else if (_episodeId is int)
            {
                _mediaType = "episode";
            }
            else
            {
                _mediaType = "movie";
                _tmdbId    = await SubtitleApiClient.GetMovieTmdbIdAsync(_mediaId, _cts.Token)
                    .ConfigureAwait(true);
            }

            _imdbId = _passedImdbId;
            if (string.IsNullOrWhiteSpace(_imdbId))
            {
                int? lookupTmdb = _mediaType == "episode" ? _parentTmdbId : _tmdbId;
                if (lookupTmdb is int tid)
                {
                    var mt = _mediaType == "episode" ? "Series" : "Movie";
                    _imdbId = await SubtitleApiClient.GetImdbIdAsync(tid, mt, _cts.Token)
                        .ConfigureAwait(true);
                }
            }
        }
        catch (Exception ex)
        {
            App.Log($"SubtitleSearchOverlay.ResolveSearchContext: {ex.Message}");
        }
    }

    private string? SelectedLanguageCode =>
        (LanguageCombo.SelectedItem as ComboBoxItem)?.Tag as string;

    private static bool MatchesLanguage(string language, string? code)
    {
        if (string.IsNullOrEmpty(code)) return true;
        var lower = language.ToLowerInvariant();
        var baseCode = lower.Split('-', ' ')[0].Trim();
        return code switch
        {
            "en" => baseCode == "en" || lower.Contains("english"),
            "ar" => baseCode == "ar" || lower.Contains("arabic"),
            _    => true
        };
    }

    private async Task RunSearchAsync()
    {
        if (_isSearching) return;
        var query = SearchBox.Text.Trim();
        if (string.IsNullOrEmpty(query))
        {
            SetStatus("Enter a search query.");
            return;
        }

        _isSearching = true;
        SetStatus("Searching…");
        ClearResults();

        try
        {
            var osTask = SubtitleApiClient.SearchOpenSubtitlesAsync(
                query,
                _mediaType,
                _season,
                _episodeNumber,
                _mediaType == "movie" ? _tmdbId : null,
                _mediaType == "episode" ? _parentTmdbId : null,
                _cts.Token);

            var sdlTask = SubtitleApiClient.SearchSubDlAsync(
                query,
                _imdbId,
                _mediaType == "movie" ? _tmdbId : _parentTmdbId,
                _mediaType == "movie" ? "Movie" : "Series",
                _season,
                _episodeNumber,
                _cts.Token);

            var ssTask = SubtitleApiClient.SearchSubSourceAsync(
                query,
                _imdbId,
                _mediaType == "movie" ? "Movie" : "Series",
                _season,
                _cts.Token);

            await Task.WhenAll(osTask, sdlTask, ssTask).ConfigureAwait(true);

            var osPayload  = await osTask.ConfigureAwait(true);
            var sdlPayload = await sdlTask.ConfigureAwait(true);
            var ssPayload  = await ssTask.ConfigureAwait(true);

            var lang = SelectedLanguageCode;
            _osResults = osPayload.Items.Where(r => MatchesLanguage(r.Language, lang)).ToList();
            _subDlResults = sdlPayload.Items.Where(r => MatchesLanguage(r.Language, lang)).ToList();
            _subSourceResults = ssPayload.Items.Where(r => MatchesLanguage(r.Language, lang)).ToList();

            if (!string.IsNullOrWhiteSpace(osPayload.Error) && _osResults.Count == 0)
                SetStatus(osPayload.Error);
            else if (!string.IsNullOrWhiteSpace(sdlPayload.Error) && _subDlResults.Count == 0 && _osResults.Count == 0)
                SetStatus(sdlPayload.Error);
            else if (!string.IsNullOrWhiteSpace(ssPayload.Error) && _subSourceResults.Count == 0 &&
                     _subDlResults.Count == 0 && _osResults.Count == 0)
                SetStatus(ssPayload.Error);
            else
            {
                int count = _activeTab switch
                {
                    ProviderTab.OpenSubtitles => _osResults.Count,
                    ProviderTab.SubDl         => _subDlResults.Count,
                    _                         => _subSourceResults.Count
                };
                SetStatus(count == 1 ? "1 result found" : $"{count} results found");
            }

            RenderResults();
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            SetStatus($"Search failed: {ex.Message}");
        }
        finally
        {
            _isSearching = false;
        }
    }

    private void RenderResults()
    {
        ClearResults();

        switch (_activeTab)
        {
            case ProviderTab.OpenSubtitles:
                if (_osResults.Count == 0)
                {
                    ResultsPanel.Children.Add(MakeEmptyLabel("No OpenSubtitles results."));
                    return;
                }
                foreach (var row in _osResults)
                    ResultsPanel.Children.Add(BuildOsRow(row));
                break;

            case ProviderTab.SubDl:
                if (_subDlResults.Count == 0)
                {
                    ResultsPanel.Children.Add(MakeEmptyLabel("No SubDL results."));
                    return;
                }
                foreach (var row in _subDlResults)
                    ResultsPanel.Children.Add(BuildSubDlRow(row));
                break;

            case ProviderTab.SubSource:
                if (_subSourceResults.Count == 0)
                {
                    ResultsPanel.Children.Add(MakeEmptyLabel("No SubSource results."));
                    return;
                }
                foreach (var row in _subSourceResults)
                    ResultsPanel.Children.Add(BuildSubSourceRow(row));
                break;
        }
    }

    private static TextBlock MakeEmptyLabel(string text) => new()
    {
        Text         = text,
        Foreground   = MutedBrush,
        Margin       = new Thickness(8, 16, 8, 8),
        HorizontalAlignment = HorizontalAlignment.Center
    };

    private UIElement BuildOsRow(OsSubtitleRow row)
    {
        var grid = new Grid { Margin = new Thickness(0, 0, 0, 6), Height = 56 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 4, 8, 4) };
        left.Children.Add(new TextBlock
        {
            Text         = Truncate(row.ReleaseName, 52),
            Foreground   = Brushes.White,
            FontWeight   = FontWeights.SemiBold,
            TextTrimming = TextTrimming.CharacterEllipsis
        });

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 0) };
        meta.Children.Add(MakeBadge(row.Language));
        meta.Children.Add(new TextBlock
        {
            Text       = "  ·  —  ·  " + (row.DownloadCount > 0 ? $"{row.DownloadCount:N0} dl" : "—"),
            Foreground = MutedBrush,
            FontSize   = 11,
            VerticalAlignment = VerticalAlignment.Center
        });
        left.Children.Add(meta);

        var loadBtn = MakeLoadButton();
        loadBtn.Click += async (_, _) => await LoadOpenSubtitlesAsync(row).ConfigureAwait(true);

        var rowBorder = new Border
        {
            Background  = RowBrush,
            CornerRadius = new CornerRadius(8),
            Child       = grid
        };

        Grid.SetColumn(left, 0);
        Grid.SetColumn(loadBtn, 1);
        grid.Children.Add(left);
        grid.Children.Add(loadBtn);

        return rowBorder;
    }

    private UIElement BuildSubDlRow(SubDlSubtitleRow row)
    {
        var grid = new Grid { Margin = new Thickness(0, 0, 0, 6), Height = 56 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 4, 8, 4) };
        left.Children.Add(new TextBlock
        {
            Text         = Truncate(row.ReleaseName, 52),
            Foreground   = Brushes.White,
            FontWeight   = FontWeights.SemiBold,
            TextTrimming = TextTrimming.CharacterEllipsis
        });

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 0) };
        meta.Children.Add(MakeBadge(row.Language));
        meta.Children.Add(new TextBlock
        {
            Text       = "  ·  —  ·  —",
            Foreground = MutedBrush,
            FontSize   = 11,
            VerticalAlignment = VerticalAlignment.Center
        });
        left.Children.Add(meta);

        var loadBtn = MakeLoadButton();
        loadBtn.Click += async (_, _) => await LoadSubDlAsync(row).ConfigureAwait(true);

        var rowBorder = new Border
        {
            Background   = RowBrush,
            CornerRadius = new CornerRadius(8),
            Child        = grid
        };

        Grid.SetColumn(left, 0);
        Grid.SetColumn(loadBtn, 1);
        grid.Children.Add(left);
        grid.Children.Add(loadBtn);

        return rowBorder;
    }

    private UIElement BuildSubSourceRow(SubSourceSubtitleRow row)
    {
        var grid = new Grid { Margin = new Thickness(0, 0, 0, 6), Height = 56 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var left = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(8, 4, 8, 4) };
        left.Children.Add(new TextBlock
        {
            Text         = Truncate(row.ReleaseName, 52),
            Foreground   = Brushes.White,
            FontWeight   = FontWeights.SemiBold,
            TextTrimming = TextTrimming.CharacterEllipsis
        });

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 0) };
        meta.Children.Add(MakeBadge(row.Language));
        meta.Children.Add(new TextBlock
        {
            Text       = "  ·  —  ·  —",
            Foreground = MutedBrush,
            FontSize   = 11,
            VerticalAlignment = VerticalAlignment.Center
        });
        left.Children.Add(meta);

        var loadBtn = MakeLoadButton();
        loadBtn.Click += async (_, _) => await LoadSubSourceAsync(row).ConfigureAwait(true);

        var rowBorder = new Border
        {
            Background   = RowBrush,
            CornerRadius = new CornerRadius(8),
            Child        = grid
        };

        Grid.SetColumn(left, 0);
        Grid.SetColumn(loadBtn, 1);
        grid.Children.Add(left);
        grid.Children.Add(loadBtn);

        return rowBorder;
    }

    private static Border MakeBadge(string language)
    {
        return new Border
        {
            Background   = new SolidColorBrush(Color.FromRgb(0x2D, 0x2D, 0x2D)),
            CornerRadius = new CornerRadius(4),
            Padding      = new Thickness(6, 2, 6, 2),
            Child = new TextBlock
            {
                Text       = language,
                Foreground = Brushes.White,
                FontSize   = 10
            }
        };
    }

    private static Button MakeLoadButton() => new()
    {
        Content           = "Load",
        Margin            = new Thickness(0, 0, 8, 0),
        VerticalAlignment = VerticalAlignment.Center,
        Background        = AccentBrush,
        Foreground        = Brushes.White,
        BorderThickness   = new Thickness(0),
        Padding           = new Thickness(12, 6, 12, 6),
        Cursor            = Cursors.Hand,
        FontWeight        = FontWeights.SemiBold,
        FontFamily        = new FontFamily("Segoe UI")
    };

    private async Task LoadOpenSubtitlesAsync(OsSubtitleRow row)
    {
        SetStatus("Downloading…");
        DisableLoadButtons(true);

        try
        {
            var lang = SelectedLanguageCode;
            if (string.IsNullOrEmpty(lang)) lang = row.Language.Split('-')[0].Trim();
            if (string.IsNullOrEmpty(lang)) lang = "en";

            var (ok, path, err) = await SubtitleApiClient.DownloadOpenSubtitlesAsync(
                row.FileId, _videoFilePath, lang, _cts.Token).ConfigureAwait(true);

            if (!ok || string.IsNullOrWhiteSpace(path))
            {
                SetStatus(err ?? "Download failed.");
                DisableLoadButtons(false);
                return;
            }

            await LoadSubtitleIntoMpvAsync(path).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
            DisableLoadButtons(false);
        }
    }

    private async Task LoadSubDlAsync(SubDlSubtitleRow row)
    {
        SetStatus("Downloading…");
        DisableLoadButtons(true);

        try
        {
            var lang = row.Language;
            var (ok, path, err) = await SubtitleApiClient.DownloadSubDlAsync(
                row.FullLink, _videoFilePath, lang, _cts.Token).ConfigureAwait(true);

            if (!ok || string.IsNullOrWhiteSpace(path))
            {
                SetStatus(err ?? "Download failed.");
                DisableLoadButtons(false);
                return;
            }

            await LoadSubtitleIntoMpvAsync(path).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
            DisableLoadButtons(false);
        }
    }

    private async Task LoadSubSourceAsync(SubSourceSubtitleRow row)
    {
        SetStatus("Downloading…");
        DisableLoadButtons(true);

        try
        {
            var (ok, path, err) = await SubtitleApiClient.DownloadSubSourceAsync(
                row.SubtitleId, _videoFilePath, row.Language, _cts.Token).ConfigureAwait(true);

            if (!ok || string.IsNullOrWhiteSpace(path))
            {
                SetStatus(err ?? "Download failed.");
                DisableLoadButtons(false);
                return;
            }

            await LoadSubtitleIntoMpvAsync(path).ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            SetStatus(ex.Message);
            DisableLoadButtons(false);
        }
    }

    private async Task LoadSubtitleIntoMpvAsync(string savedPath)
    {
        string absolute;
        try { absolute = System.IO.Path.GetFullPath(savedPath); }
        catch { absolute = savedPath; }

        await _ipc.SendAsync("sub-add", absolute, "select").ConfigureAwait(true);

        SetStatus("Loaded ✓");
        await Task.Delay(2000, _cts.Token).ConfigureAwait(true);
        CloseAndResume();
    }

    private void CloseAndResume()
    {
        if (_isClosing) return;
        _isClosing = true;
        ResumePlayback();
        Close();
    }

    private void DisableLoadButtons(bool disabled)
    {
        foreach (var child in ResultsPanel.Children)
        {
            if (child is Border b && b.Child is Grid g)
            {
                foreach (var c in g.Children)
                {
                    if (c is Button btn) btn.IsEnabled = !disabled;
                }
            }
        }
    }

    private void ClearResults() => ResultsPanel.Children.Clear();

    private void SetStatus(string text) =>
        Dispatcher.Invoke(() => StatusLabel.Text = text);

    private static string Truncate(string s, int max) =>
        s.Length <= max ? s : s[..(max - 1)] + "…";

    private void UpdateTabStyles()
    {
        OsTabButton.Background        = _activeTab == ProviderTab.OpenSubtitles ? AccentBrush : Brushes.Transparent;
        OsTabButton.Foreground         = _activeTab == ProviderTab.OpenSubtitles ? Brushes.White : MutedBrush;
        SubDlTabButton.Background      = _activeTab == ProviderTab.SubDl ? AccentBrush : Brushes.Transparent;
        SubDlTabButton.Foreground      = _activeTab == ProviderTab.SubDl ? Brushes.White : MutedBrush;
        SubSourceTabButton.Background  = _activeTab == ProviderTab.SubSource ? AccentBrush : Brushes.Transparent;
        SubSourceTabButton.Foreground  = _activeTab == ProviderTab.SubSource ? Brushes.White : MutedBrush;
    }

    private void OnOsTabClick(object sender, RoutedEventArgs e)
    {
        _activeTab = ProviderTab.OpenSubtitles;
        UpdateTabStyles();
        int count = _osResults.Count;
        SetStatus(count == 1 ? "1 result found" : $"{count} results found");
        RenderResults();
    }

    private void OnSubDlTabClick(object sender, RoutedEventArgs e)
    {
        _activeTab = ProviderTab.SubDl;
        UpdateTabStyles();
        int count = _subDlResults.Count;
        SetStatus(count == 1 ? "1 result found" : $"{count} results found");
        RenderResults();
    }

    private void OnSubSourceTabClick(object sender, RoutedEventArgs e)
    {
        _activeTab = ProviderTab.SubSource;
        UpdateTabStyles();
        int count = _subSourceResults.Count;
        SetStatus(count == 1 ? "1 result found" : $"{count} results found");
        RenderResults();
    }

    private async void OnSearchClick(object sender, RoutedEventArgs e) =>
        await RunSearchAsync().ConfigureAwait(true);

    private async void OnLanguageChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!IsLoaded || _isSearching) return;
        await RunSearchAsync().ConfigureAwait(true);
    }

    private async void OnSearchBoxKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            e.Handled = true;
            await RunSearchAsync().ConfigureAwait(true);
        }
    }

    private void OnWindowKeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            e.Handled = true;
            CloseAndResume();
        }
    }

    private void OnDeactivated(object? sender, EventArgs e)
    {
        if (_isClosing) return;
        // ComboBox dropdown is a separate popup — don't treat it as "click outside".
        if (LanguageCombo.IsDropDownOpen) return;
        CloseAndResume();
    }

    private void OnCloseClick(object sender, RoutedEventArgs e) => CloseAndResume();
}

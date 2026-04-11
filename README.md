# Pitflix

A modern, cross-platform media library manager for organizing and browsing your movie and TV show collection.

## Overview

Pitflix is a desktop application that helps you manage your local video library by automatically scanning, organizing, and enriching your media files with metadata from The Movie Database (TMDB). It provides a beautiful, Netflix-style interface for browsing your collection, tracking what you've watched, and discovering content.

## Key Features

- **Automatic Media Scanning**: Recursively scans directories for video files and automatically matches them with TMDB metadata
- **Smart Matching**: Intelligent file name parsing to identify movies and TV shows
- **Rich Metadata**: Fetches posters, backdrops, cast information, ratings, and descriptions from TMDB
- **Watch Tracking**: Keep track of what you've watched and when
- **Custom Lists**: Create and manage custom lists of your favorite content
- **Arabic Support**: Built-in support for Arabic titles and content
- **Unmatched Files Management**: Review and manually match files that couldn't be automatically identified
- **Statistics Dashboard**: View insights about your collection and watch history
- **Subtitle Support**: Browse and download subtitles for your media
- **Modern UI**: Beautiful, responsive interface with smooth animations

## Architecture

Pitflix is built using a modern, multi-layered architecture:

### Technology Stack

#### Backend (API)
- **Language**: C# / .NET 8.0
- **Framework**: ASP.NET Core Web API
- **Database**: SQLite with Entity Framework Core
- **Architecture**: Clean architecture with separate layers

#### Frontend (UI)
- **Language**: TypeScript
- **Framework**: React 19
- **Build Tool**: Vite
- **Desktop Framework**: Tauri 2 (Rust)
- **Styling**: TailwindCSS
- **State Management**: Zustand
- **Data Fetching**: TanStack Query (React Query)
- **Routing**: React Router
- **Animations**: Framer Motion

### Project Structure

```
PitFilx-app/
├── Pitflix.Core/          # Core business logic and models
│   ├── Models/            # Data models (Movie, Show, Episode, etc.)
│   ├── Scanner/           # File scanning and parsing logic
│   ├── Parser/            # Name parsing for media files
│   ├── Database/          # EF Core context and repository
│   └── Services/          # Core services
│
├── Pitflix.API/           # ASP.NET Core Web API
│   ├── Program.cs         # API entry point and configuration
│   ├── Controllers/       # API endpoints
│   └── Services/          # API-specific services
│
└── Pitflix.UI/            # Tauri + React frontend
    ├── src/
    │   ├── api/           # API client functions
    │   ├── components/    # React components
    │   ├── pages/         # Page components
    │   ├── hooks/         # Custom React hooks
    │   ├── store/         # Zustand stores
    │   └── utils/         # Utility functions
    └── src-tauri/         # Tauri/Rust backend
        ├── src/           # Rust source code
        └── Cargo.toml     # Rust dependencies
```

## How It Works

1. **Library Setup**: Configure one or more folders containing your video files
2. **Scanning**: The file scanner recursively searches for video files (mkv, mp4, avi, etc.)
3. **Parsing**: File names are parsed to extract title, year, season/episode information
4. **Matching**: Parsed information is used to search TMDB and match content
5. **Metadata Enrichment**: Matched content is enriched with posters, backdrops, cast, ratings, etc.
6. **Browsing**: Browse your organized collection through the modern UI
7. **Tracking**: Mark content as watched, add to lists, and track your viewing history

## Feature Internals (Docs)

- `docs/TRAILERS_AND_AWARDS.md` — how the **Trailers** and **Awards** features work end-to-end (UI → API → data/caching).

## API Endpoints

The backend API runs on `http://127.0.0.1:5001` by default and provides:

- `/api/library/*` - Library management and folder configuration
- `/api/movies/*` - Movie browsing and details
- `/api/series/*` - TV show browsing and details
- `/api/episodes/*` - Episode information
- `/api/scan/*` - Scanning operations
- `/api/unmatched/*` - Unmatched file management
- `/api/lists/*` - Custom list management
- `/api/watch/*` - Watch status and history
- `/api/subtitles/*` - Subtitle search and download
- `/api/stats/*` - Collection statistics
- `/api/settings/*` - Application settings

## Database Schema

The application uses SQLite with the following main entities:

- **Movies**: Movie metadata and file paths
- **Shows**: TV show metadata and folder paths
- **Episodes**: Episode details linked to shows
- **LibraryFolders**: Configured library paths
- **UserLists**: Custom user-created lists
- **WatchHistory**: Viewing history and progress
- **CastMembers**: Actor/crew information
- **Settings**: Application configuration

## Development

### Prerequisites

- .NET 8.0 SDK
- Node.js 18+ and npm
- Rust (for Tauri)
- TMDB API Key

### Running the Application

1. **Start the API**:
   ```bash
   cd Pitflix.API
   dotnet run
   ```

2. **Start the UI** (in development mode):
   ```bash
   cd Pitflix.UI
   npm install
   npm run tauri dev
   ```

### Building for Production

**Windows Build**:
```bash
cd Pitflix.UI
npm run tauri:build:win
```

This creates a distributable installer with the API bundled as a sidecar process.

## Configuration

### TMDB API Key

Required for metadata fetching. Can be configured:
- Through the setup wizard on first launch
- In the settings page
- Via environment variable or local config file

### Library Folders

Add one or more folders containing your media files through the settings interface. The scanner will recursively search these folders for video files.

### Supported Video Formats

- .mkv
- .mp4
- .avi
- .m4v
- .wmv
- .webm
- .mov
- .mpeg / .mpg
- .flv

## Features in Detail

### Smart File Parsing

The name parser can handle various file naming conventions:
- `Movie Title (2020).mkv`
- `Movie.Title.2020.1080p.BluRay.mkv`
- `Show Name S01E01.mkv`
- `Show.Name.1x01.Episode.Title.mkv`

### Arabic Content Support

- Detects Arabic characters in file names
- Fetches Arabic titles and metadata when available
- Supports RTL text display in the UI

### Watch Status

Track your viewing progress with three states:
- Unwatched
- In Progress (with resume position)
- Completed

### Custom Lists

Create themed lists like:
- Favorites
- Watch Later
- Best of 2024
- Custom categories

## License

This project is for personal use. TMDB data is used under their API terms of service.

## Credits

- Metadata provided by [The Movie Database (TMDB)](https://www.themoviedb.org/)
- Built with [Tauri](https://tauri.app/), [React](https://react.dev/), and [.NET](https://dotnet.microsoft.com/)

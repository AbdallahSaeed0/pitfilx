; Registers Pitflix as an available "Open with" handler (NOT the default) for common video
; file types, so it shows up in Explorer's "Open with" list/right-click menu without hijacking
; whatever the user's default player already is.
;
; The installed binary is named pitflixui.exe (Cargo package name), NOT Pitflix.exe (that's
; only the display productName) — confirmed via the actual install at
; %LOCALAPPDATA%\Pitflix\pitflixui.exe. Registry entries must key off the real filename or
; Windows silently ignores them.
;
; Per-user (HKCU) so it works without elevation and cleanly reverses on uninstall regardless of
; which user account installed/uninstalled. Two registry mechanisms are written for reliability:
;   1. Applications\pitflixui.exe\SupportedTypes — lets Windows offer Pitflix for these
;      extensions generally (Default Apps > Choose defaults by file type, "Open with" dialog).
;   2. Classes\<ext>\OpenWithList\pitflixui.exe — makes Pitflix show directly in the file's
;      right-click "Open with" submenu even before the user has ever picked it for that type.

; Before copying files: stop the background processes Tauri's own "app is running" check doesn't
; know about. The API sidecar (pitflix-api.exe) keeps running after the window closes, and a running
; exe is locked — the installer then silently keeps the OLD backend while installing the new UI
; (happened with the 2026-10-02 build: new pitflixui.exe, Sep 28 pitflix-api.exe). Only our own image
; names are targeted; mpv.exe is left alone since other players use that name too.
!macro NSIS_HOOK_PREINSTALL
  nsExec::Exec 'taskkill /F /T /IM pitflix-api.exe'
  Pop $0
  nsExec::Exec 'taskkill /F /T /IM PitflixPlayer.exe'
  Pop $0
  Sleep 1500 ; let Windows release the file handles
!macroend

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Applications\pitflixui.exe\shell\open\command" "" '"$INSTDIR\pitflixui.exe" "%1"'
  WriteRegStr HKCU "Software\Classes\Applications\pitflixui.exe" "FriendlyAppName" "Pitflix"
  WriteRegStr HKCU "Software\Classes\Applications\pitflixui.exe\DefaultIcon" "" "$INSTDIR\pitflixui.exe,0"

  WriteRegStr HKCU "Software\Classes\Applications\pitflixui.exe\SupportedTypes" ".mp4" ""
  WriteRegStr HKCU "Software\Classes\Applications\pitflixui.exe\SupportedTypes" ".mkv" ""
  WriteRegStr HKCU "Software\Classes\Applications\pitflixui.exe\SupportedTypes" ".avi" ""
  WriteRegStr HKCU "Software\Classes\Applications\pitflixui.exe\SupportedTypes" ".mov" ""
  WriteRegStr HKCU "Software\Classes\Applications\pitflixui.exe\SupportedTypes" ".webm" ""

  WriteRegStr HKCU "Software\Classes\.mp4\OpenWithList\pitflixui.exe" "" ""
  WriteRegStr HKCU "Software\Classes\.mkv\OpenWithList\pitflixui.exe" "" ""
  WriteRegStr HKCU "Software\Classes\.avi\OpenWithList\pitflixui.exe" "" ""
  WriteRegStr HKCU "Software\Classes\.mov\OpenWithList\pitflixui.exe" "" ""
  WriteRegStr HKCU "Software\Classes\.webm\OpenWithList\pitflixui.exe" "" ""

  ; Right-click on a FOLDER in Explorer → two Pitflix actions (HKCU\...\Directory\shell, NOT
  ; Directory\Background\shell — that variant only fires from empty space *inside* a folder).
  ; %1 is substituted with the folder's own path for a Directory verb. Each verb's own Icon key
  ; makes Explorer show the Pitflix icon next to it in the context menu, same as "Open in Terminal"
  ; or other shell extensions. The launched process picks these up via --scan-folder/
  ; --add-device-folder argv flags (see extract_folder_action_from_args in src-tauri/src/lib.rs).
  WriteRegStr HKCU "Software\Classes\Directory\shell\PitflixScanFolder" "" "Scan this folder to Pitflix"
  WriteRegStr HKCU "Software\Classes\Directory\shell\PitflixScanFolder" "Icon" "$INSTDIR\pitflixui.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\PitflixScanFolder\command" "" '"$INSTDIR\pitflixui.exe" --scan-folder "%1"'

  WriteRegStr HKCU "Software\Classes\Directory\shell\PitflixAddDeviceFolder" "" "Add this folder to My Device"
  WriteRegStr HKCU "Software\Classes\Directory\shell\PitflixAddDeviceFolder" "Icon" "$INSTDIR\pitflixui.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\PitflixAddDeviceFolder\command" "" '"$INSTDIR\pitflixui.exe" --add-device-folder "%1"'
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Applications\pitflixui.exe"
  DeleteRegValue HKCU "Software\Classes\.mp4\OpenWithList" "pitflixui.exe"
  DeleteRegValue HKCU "Software\Classes\.mkv\OpenWithList" "pitflixui.exe"
  DeleteRegValue HKCU "Software\Classes\.avi\OpenWithList" "pitflixui.exe"
  DeleteRegValue HKCU "Software\Classes\.mov\OpenWithList" "pitflixui.exe"
  DeleteRegValue HKCU "Software\Classes\.webm\OpenWithList" "pitflixui.exe"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\PitflixScanFolder"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\PitflixAddDeviceFolder"
!macroend

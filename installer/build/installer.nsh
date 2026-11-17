; Custom NSIS hooks for the CyexsDock installer, wired in via Tauri's
; `bundle.windows.nsis.installerHooks` (tauri.conf.json). Tauri builds the
; installer; this file only adds the bits below on top of its template.
;
; The window uses the standard MUI2 look. A dark theme (MUI_BGCOLOR) used to be
; set here, but MUI2 only recolors some pages: the Choose Users and progress
; pages stayed light, and the finish page checkbox labels turned black on black.

; Icon on the right side of the page header, next to the title text.
!define MUI_HEADERIMAGE_RIGHT

!macro NSIS_HOOK_PREINSTALL
  ; Keep the old custom uninstaller (a full app, > 1 MB) if an earlier install shipped one.
  ; File size is read with FileSeek: ${GetSize} wrote "Size:0 Kb Files: Folders:" into the progress page.
  StrCpy $0 0
  ${If} ${FileExists} "$INSTDIR\uninstall.exe"
    FileOpen $1 "$INSTDIR\uninstall.exe" r
    FileSeek $1 0 END $0
    FileClose $1
  ${EndIf}
  ${If} $0 > 1048576
    CopyFiles /SILENT "$INSTDIR\uninstall.exe" "$TEMP\cyexsdock-uninstall.keep"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ${If} ${FileExists} "$TEMP\cyexsdock-uninstall.keep"
    CopyFiles /SILENT "$TEMP\cyexsdock-uninstall.keep" "$INSTDIR\uninstall.exe"
    Delete "$TEMP\cyexsdock-uninstall.keep"
    WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\" --uninstall"
  ${Else}
    Delete "$INSTDIR\uninstall.exe"
    WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --uninstall"
  ${EndIf}
  FileOpen $0 "$INSTDIR\.install-scope" w
  ${If} $MultiUser.InstallMode == "AllUsers"
    FileWrite $0 "all-users"
  ${Else}
    FileWrite $0 "user"
  ${EndIf}
  FileClose $0
!macroend

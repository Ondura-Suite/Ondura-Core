; Mirra Office NSIS hooks.
; The suite is a single binary; every app gets its own Start menu and desktop
; shortcut that launches the binary with `--app <id>`.
; When a new app becomes available, add it to both macros below (and to
; src-tauri/linux/ for Linux packages).

!macro MIRRA_APP_SHORTCUT NAME ID
  CreateShortcut "$SMPROGRAMS\Mirra Office\${NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app ${ID}" "$INSTDIR\icons\${ID}.ico" 0
  CreateShortcut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app ${ID}" "$INSTDIR\icons\${ID}.ico" 0
!macroend

!macro MIRRA_APP_REMOVE NAME
  Delete "$SMPROGRAMS\Mirra Office\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$SMPROGRAMS\Mirra Office"
  !insertmacro MIRRA_APP_SHORTCUT "Mirra Mail" "mail"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro MIRRA_APP_REMOVE "Mirra Mail"
  RMDir "$SMPROGRAMS\Mirra Office"
!macroend

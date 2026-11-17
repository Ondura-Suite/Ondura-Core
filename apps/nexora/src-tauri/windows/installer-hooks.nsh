; Nexora NSIS hooks.
; The suite is a single binary; every app gets its own Start menu and desktop
; shortcut that launches the binary with `--app <id>`.
; When a new app becomes available, add it to both hooks below, to
; `bundle.resources` in tauri.conf.json and to src-tauri/linux/.

!macro NEXORA_APP_SHORTCUT NAME ID
  CreateShortcut "$SMPROGRAMS\Nexora\${NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app ${ID}" "$INSTDIR\icons\${ID}.ico" 0
  CreateShortcut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app ${ID}" "$INSTDIR\icons\${ID}.ico" 0
!macroend

!macro NEXORA_APP_REMOVE NAME
  Delete "$SMPROGRAMS\Nexora\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$SMPROGRAMS\Nexora"
  !insertmacro NEXORA_APP_SHORTCUT "Relay" "mail"
  !insertmacro NEXORA_APP_SHORTCUT "Nexora Kalender" "calendar"
  !insertmacro NEXORA_APP_SHORTCUT "Nexora Kontakte" "contacts"
  !insertmacro NEXORA_APP_SHORTCUT "Nexora Aufgaben" "tasks"
  ; Shortcuts of the pre-rename "Mirra Office" installation.
  Delete "$SMPROGRAMS\Mirra Office\Mirra Mail.lnk"
  Delete "$DESKTOP\Mirra Mail.lnk"
  RMDir "$SMPROGRAMS\Mirra Office"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro NEXORA_APP_REMOVE "Relay"
  !insertmacro NEXORA_APP_REMOVE "Nexora Kalender"
  !insertmacro NEXORA_APP_REMOVE "Nexora Kontakte"
  !insertmacro NEXORA_APP_REMOVE "Nexora Aufgaben"
  RMDir "$SMPROGRAMS\Nexora"
!macroend

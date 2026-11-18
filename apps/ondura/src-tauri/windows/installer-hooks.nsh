; Non-ASCII characters are written as ${U+XXXX} because NSIS reads this file in the ANSI code page.
; Ondura NSIS hooks.
; The suite is a single binary; every app gets its own Start menu and desktop
; shortcut that launches the binary with `--app <id>`. Calendar, contacts and
; tasks are modules inside Ondura Mail and have no shortcut of their own.
; When a new app becomes available, add it to the hooks below, to
; `bundle.resources` in tauri.conf.json and to src-tauri/linux/.
;
; Components: Ondura Mail can be installed on its own; the office apps (Text,
; Tabellen, Präsentation) are only installed together. The choice is made on
; a page of installer.nsi (functions below), with `/MAILONLY` or `/OFFICEONLY`
; on the command line for silent installs, and remembered in the registry. It
; is written to components.ini next to the binary, which the app reads to hide
; the apps that are not installed.

!include nsDialogs.nsh
!include LogicLib.nsh

!define ONDURA_KEY "Software\MirraNET\Ondura"

Var OnduraMail
Var OnduraOffice
Var OnduraMailBox
Var OnduraOfficeBox

; Previous selection (or everything), then command line overrides.
Function OnduraDefaults
  ${If} $OnduraMail != ""
    Return
  ${EndIf}
  StrCpy $OnduraMail 1
  StrCpy $OnduraOffice 1
  ClearErrors
  ReadRegStr $0 HKLM "${ONDURA_KEY}" "Mail"
  ${IfNot} ${Errors}
    StrCpy $OnduraMail $0
    ReadRegStr $OnduraOffice HKLM "${ONDURA_KEY}" "Office"
  ${EndIf}
  ${GetOptions} $CMDLINE "/MAILONLY" $0
  ${IfNot} ${Errors}
    StrCpy $OnduraMail 1
    StrCpy $OnduraOffice 0
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/OFFICEONLY" $0
  ${IfNot} ${Errors}
    StrCpy $OnduraMail 0
    StrCpy $OnduraOffice 1
  ${EndIf}
  ${If} $OnduraMail != 1
  ${AndIf} $OnduraOffice != 1
    StrCpy $OnduraMail 1
  ${EndIf}
FunctionEnd

Function OnduraComponentsPage
  Call SkipIfPassive
  Call OnduraDefaults
  !insertmacro MUI_HEADER_TEXT "Apps ausw${U+00E4}hlen" "W${U+00E4}hlen Sie, welche Ondura-Apps installiert werden sollen."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateCheckbox} 0 0 100% 12u "Ondura Mail"
  Pop $OnduraMailBox
  ${NSD_CreateLabel} 14u 13u -14u 20u "E-Mail, Kalender, Kontakte und Aufgaben ${U+2013} Microsoft 365, Exchange, IMAP/SMTP und CalDAV/CardDAV."
  Pop $0
  ${NSD_CreateCheckbox} 0 40u 100% 12u "Office-Apps"
  Pop $OnduraOfficeBox
  ${NSD_CreateLabel} 14u 53u -14u 20u "Ondura Text, Ondura Tabellen und Ondura Pr${U+00E4}sentation (Word-, Excel- und PowerPoint-Dateien). Diese Apps werden nur gemeinsam installiert."
  Pop $0
  ${NSD_CreateLabel} 0 90u 100% 20u "Mindestens eine Komponente muss ausgew${U+00E4}hlt sein. Sie k${U+00F6}nnen das Setup sp${U+00E4}ter erneut ausf${U+00FC}hren, um die Auswahl zu ${U+00E4}ndern."
  Pop $0
  ${If} $OnduraMail == 1
    ${NSD_Check} $OnduraMailBox
  ${EndIf}
  ${If} $OnduraOffice == 1
    ${NSD_Check} $OnduraOfficeBox
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function OnduraComponentsLeave
  ${NSD_GetState} $OnduraMailBox $0
  ${NSD_GetState} $OnduraOfficeBox $1
  ${If} $0 != ${BST_CHECKED}
  ${AndIf} $1 != ${BST_CHECKED}
    MessageBox MB_ICONEXCLAMATION|MB_OK "Bitte w${U+00E4}hlen Sie mindestens eine Komponente aus."
    Abort
  ${EndIf}
  StrCpy $OnduraMail 0
  StrCpy $OnduraOffice 0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $OnduraMail 1
  ${EndIf}
  ${If} $1 == ${BST_CHECKED}
    StrCpy $OnduraOffice 1
  ${EndIf}
FunctionEnd

!macro ONDURA_APP_SHORTCUT NAME ID
  CreateShortcut "$SMPROGRAMS\Ondura\${NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app ${ID}" "$INSTDIR\icons\${ID}.ico" 0
  CreateShortcut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app ${ID}" "$INSTDIR\icons\${ID}.ico" 0
!macroend

!macro ONDURA_APP_REMOVE NAME
  Delete "$SMPROGRAMS\Ondura\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
!macroend

; "Ondura Update" service: installs signed updates without a UAC prompt
; (update_helper.rs). Every user may start it; it only accepts installers
; signed with the Ondura update key.
!define ONDURA_SERVICE "OnduraUpdate"
!define ONDURA_SC '"$SYSDIR\sc.exe"'

!macro ONDURA_SERVICE_INSTALL
  nsExec::Exec '${ONDURA_SC} create ${ONDURA_SERVICE} binPath= "\"$INSTDIR\${MAINBINARYNAME}.exe\" --update-service" start= demand obj= LocalSystem DisplayName= "Ondura Update"'
  Pop $0
  nsExec::Exec '${ONDURA_SC} config ${ONDURA_SERVICE} binPath= "\"$INSTDIR\${MAINBINARYNAME}.exe\" --update-service" start= demand obj= LocalSystem'
  Pop $0
  nsExec::Exec '${ONDURA_SC} description ${ONDURA_SERVICE} "Installiert signierte Ondura-Updates im Hintergrund."'
  Pop $0
  ; SYSTEM and administrators: full control; interactive and authenticated
  ; users: query and start.
  nsExec::Exec '${ONDURA_SC} sdset ${ONDURA_SERVICE} D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWRPLOCRRC;;;IU)(A;;CCLCSWRPLOCRRC;;;AU)'
  Pop $0
!macroend

!macro ONDURA_SERVICE_STOP
  nsExec::Exec '${ONDURA_SC} stop ${ONDURA_SERVICE}'
  Pop $0
  ; The service stops itself right after starting an update; give it a
  ; moment so ondura.exe is no longer in use.
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro ONDURA_SERVICE_STOP
  Call OnduraDefaults
  ; Earlier versions installed per user; remove such an installation so only
  ; the system-wide one remains.
  ClearErrors
  ReadRegStr $0 HKCU "${UNINSTKEY}" "UninstallString"
  ReadRegStr $1 HKCU "${UNINSTKEY}" "InstallLocation"
  ${IfNot} ${Errors}
  ${AndIf} $0 != ""
    DetailPrint "Entferne die bisherige Installation f${U+00FC}r den aktuellen Benutzer ..."
    ExecWait '$0 /S _?=$1' $2
    Delete $0
    RMDir $1
    DeleteRegKey HKCU "${UNINSTKEY}"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$SMPROGRAMS\Ondura"
  ${If} $OnduraMail == 1
    !insertmacro ONDURA_APP_SHORTCUT "Ondura Mail" "mail"
  ${Else}
    !insertmacro ONDURA_APP_REMOVE "Ondura Mail"
  ${EndIf}
  ${If} $OnduraOffice == 1
    !insertmacro ONDURA_APP_SHORTCUT "Ondura Text" "text"
    !insertmacro ONDURA_APP_SHORTCUT "Ondura Tabellen" "sheets"
    !insertmacro ONDURA_APP_SHORTCUT "Ondura Pr${U+00E4}sentation" "slides"
  ${Else}
    !insertmacro ONDURA_APP_REMOVE "Ondura Text"
    !insertmacro ONDURA_APP_REMOVE "Ondura Tabellen"
    !insertmacro ONDURA_APP_REMOVE "Ondura Pr${U+00E4}sentation"
    ; Without the office apps Ondura does not open Office files.
    !insertmacro APP_UNASSOCIATE "docx" "Ondura.Text.docx"
    !insertmacro APP_UNASSOCIATE "xlsx" "Ondura.Tabellen.xlsx"
    !insertmacro APP_UNASSOCIATE "pptx" "Ondura.Praesentation.pptx"
    !insertmacro APP_UNASSOCIATE "odt" "Ondura.Text.odt"
    !insertmacro APP_UNASSOCIATE "ods" "Ondura.Tabellen.ods"
    !insertmacro APP_UNASSOCIATE "odp" "Ondura.Praesentation.odp"
    !insertmacro UPDATEFILEASSOC
  ${EndIf}
  !insertmacro ONDURA_SERVICE_INSTALL
  WriteINIStr "$INSTDIR\components.ini" "Apps" "mail" $OnduraMail
  WriteINIStr "$INSTDIR\components.ini" "Apps" "office" $OnduraOffice
  WriteRegStr HKLM "${ONDURA_KEY}" "Mail" $OnduraMail
  WriteRegStr HKLM "${ONDURA_KEY}" "Office" $OnduraOffice
  ; Shortcuts of earlier versions: the mail app was called "Relay" and then
  ; "Orbit", calendar/contacts/tasks were separate apps.
  !insertmacro ONDURA_APP_REMOVE "Relay"
  !insertmacro ONDURA_APP_REMOVE "Orbit"
  !insertmacro ONDURA_APP_REMOVE "Ondura Kalender"
  !insertmacro ONDURA_APP_REMOVE "Ondura Kontakte"
  !insertmacro ONDURA_APP_REMOVE "Ondura Aufgaben"
  Delete "$INSTDIR\icons\calendar.ico"
  Delete "$INSTDIR\icons\contacts.ico"
  Delete "$INSTDIR\icons\tasks.ico"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ONDURA_SERVICE_STOP
  ${If} $UpdateMode <> 1
    nsExec::Exec '${ONDURA_SC} delete ${ONDURA_SERVICE}'
    Pop $0
  ${EndIf}
  !insertmacro ONDURA_APP_REMOVE "Ondura Mail"
  !insertmacro ONDURA_APP_REMOVE "Ondura Text"
  !insertmacro ONDURA_APP_REMOVE "Ondura Tabellen"
  !insertmacro ONDURA_APP_REMOVE "Ondura Pr${U+00E4}sentation"
  !insertmacro ONDURA_APP_REMOVE "Ondura Kalender"
  !insertmacro ONDURA_APP_REMOVE "Ondura Kontakte"
  !insertmacro ONDURA_APP_REMOVE "Ondura Aufgaben"
  RMDir "$SMPROGRAMS\Ondura"
  Delete "$INSTDIR\components.ini"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey HKLM "${ONDURA_KEY}"
  ${EndIf}
!macroend

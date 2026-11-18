; Non-ASCII characters are written as ${U+XXXX} because NSIS reads this file in the ANSI code page.
; Nexora NSIS hooks.
; The suite is a single binary; every app gets its own Start menu and desktop
; shortcut that launches the binary with `--app <id>`. Calendar, contacts and
; tasks are modules inside Orbit and have no shortcut of their own.
; When a new app becomes available, add it to the hooks below, to
; `bundle.resources` in tauri.conf.json and to src-tauri/linux/.
;
; Components: Orbit can be installed on its own; the office apps (Text,
; Tabellen, Präsentation) are only installed together. The choice is made on
; a page of installer.nsi (functions below), with `/ORBITONLY` or `/OFFICEONLY`
; on the command line for silent installs, and remembered in the registry. It
; is written to components.ini next to the binary, which the app reads to hide
; the apps that are not installed.

!include nsDialogs.nsh
!include LogicLib.nsh

!define NEXORA_KEY "Software\MirraNET\Nexora"

Var NexoraOrbit
Var NexoraOffice
Var NexoraOrbitBox
Var NexoraOfficeBox

; Previous selection (or everything), then command line overrides.
Function NexoraDefaults
  ${If} $NexoraOrbit != ""
    Return
  ${EndIf}
  StrCpy $NexoraOrbit 1
  StrCpy $NexoraOffice 1
  ClearErrors
  ReadRegStr $0 HKLM "${NEXORA_KEY}" "Orbit"
  ${IfNot} ${Errors}
    StrCpy $NexoraOrbit $0
    ReadRegStr $NexoraOffice HKLM "${NEXORA_KEY}" "Office"
  ${EndIf}
  ${GetOptions} $CMDLINE "/ORBITONLY" $0
  ${IfNot} ${Errors}
    StrCpy $NexoraOrbit 1
    StrCpy $NexoraOffice 0
  ${EndIf}
  ClearErrors
  ${GetOptions} $CMDLINE "/OFFICEONLY" $0
  ${IfNot} ${Errors}
    StrCpy $NexoraOrbit 0
    StrCpy $NexoraOffice 1
  ${EndIf}
  ${If} $NexoraOrbit != 1
  ${AndIf} $NexoraOffice != 1
    StrCpy $NexoraOrbit 1
  ${EndIf}
FunctionEnd

Function NexoraComponentsPage
  Call SkipIfPassive
  Call NexoraDefaults
  !insertmacro MUI_HEADER_TEXT "Apps ausw${U+00E4}hlen" "W${U+00E4}hlen Sie, welche Nexora-Apps installiert werden sollen."
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateCheckbox} 0 0 100% 12u "Orbit"
  Pop $NexoraOrbitBox
  ${NSD_CreateLabel} 14u 13u -14u 20u "E-Mail, Kalender, Kontakte und Aufgaben ${U+2013} Microsoft 365, Exchange, IMAP/SMTP und CalDAV/CardDAV."
  Pop $0
  ${NSD_CreateCheckbox} 0 40u 100% 12u "Office-Apps"
  Pop $NexoraOfficeBox
  ${NSD_CreateLabel} 14u 53u -14u 20u "Nexora Text, Nexora Tabellen und Nexora Pr${U+00E4}sentation (Word-, Excel- und PowerPoint-Dateien). Diese Apps werden nur gemeinsam installiert."
  Pop $0
  ${NSD_CreateLabel} 0 90u 100% 20u "Mindestens eine Komponente muss ausgew${U+00E4}hlt sein. Sie k${U+00F6}nnen das Setup sp${U+00E4}ter erneut ausf${U+00FC}hren, um die Auswahl zu ${U+00E4}ndern."
  Pop $0
  ${If} $NexoraOrbit == 1
    ${NSD_Check} $NexoraOrbitBox
  ${EndIf}
  ${If} $NexoraOffice == 1
    ${NSD_Check} $NexoraOfficeBox
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function NexoraComponentsLeave
  ${NSD_GetState} $NexoraOrbitBox $0
  ${NSD_GetState} $NexoraOfficeBox $1
  ${If} $0 != ${BST_CHECKED}
  ${AndIf} $1 != ${BST_CHECKED}
    MessageBox MB_ICONEXCLAMATION|MB_OK "Bitte w${U+00E4}hlen Sie mindestens eine Komponente aus."
    Abort
  ${EndIf}
  StrCpy $NexoraOrbit 0
  StrCpy $NexoraOffice 0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $NexoraOrbit 1
  ${EndIf}
  ${If} $1 == ${BST_CHECKED}
    StrCpy $NexoraOffice 1
  ${EndIf}
FunctionEnd

!macro NEXORA_APP_SHORTCUT NAME ID
  CreateShortcut "$SMPROGRAMS\Nexora\${NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app ${ID}" "$INSTDIR\icons\${ID}.ico" 0
  CreateShortcut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app ${ID}" "$INSTDIR\icons\${ID}.ico" 0
!macroend

!macro NEXORA_APP_REMOVE NAME
  Delete "$SMPROGRAMS\Nexora\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
!macroend

!macro NSIS_HOOK_PREINSTALL
  Call NexoraDefaults
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
  CreateDirectory "$SMPROGRAMS\Nexora"
  ${If} $NexoraOrbit == 1
    !insertmacro NEXORA_APP_SHORTCUT "Orbit" "mail"
  ${Else}
    !insertmacro NEXORA_APP_REMOVE "Orbit"
  ${EndIf}
  ${If} $NexoraOffice == 1
    !insertmacro NEXORA_APP_SHORTCUT "Nexora Text" "text"
    !insertmacro NEXORA_APP_SHORTCUT "Nexora Tabellen" "sheets"
    !insertmacro NEXORA_APP_SHORTCUT "Nexora Pr${U+00E4}sentation" "slides"
  ${Else}
    !insertmacro NEXORA_APP_REMOVE "Nexora Text"
    !insertmacro NEXORA_APP_REMOVE "Nexora Tabellen"
    !insertmacro NEXORA_APP_REMOVE "Nexora Pr${U+00E4}sentation"
    ; Without the office apps Nexora does not open Office files.
    !insertmacro APP_UNASSOCIATE "docx" "Nexora.Text.docx"
    !insertmacro APP_UNASSOCIATE "xlsx" "Nexora.Tabellen.xlsx"
    !insertmacro APP_UNASSOCIATE "pptx" "Nexora.Praesentation.pptx"
    !insertmacro APP_UNASSOCIATE "odt" "Nexora.Text.odt"
    !insertmacro APP_UNASSOCIATE "ods" "Nexora.Tabellen.ods"
    !insertmacro APP_UNASSOCIATE "odp" "Nexora.Praesentation.odp"
    !insertmacro UPDATEFILEASSOC
  ${EndIf}
  WriteINIStr "$INSTDIR\components.ini" "Apps" "orbit" $NexoraOrbit
  WriteINIStr "$INSTDIR\components.ini" "Apps" "office" $NexoraOffice
  WriteRegStr HKLM "${NEXORA_KEY}" "Orbit" $NexoraOrbit
  WriteRegStr HKLM "${NEXORA_KEY}" "Office" $NexoraOffice
  ; Shortcuts of earlier versions: the mail app was called "Relay", calendar/
  ; contacts/tasks were separate apps, and the suite was "Mirra Office".
  !insertmacro NEXORA_APP_REMOVE "Relay"
  !insertmacro NEXORA_APP_REMOVE "Nexora Kalender"
  !insertmacro NEXORA_APP_REMOVE "Nexora Kontakte"
  !insertmacro NEXORA_APP_REMOVE "Nexora Aufgaben"
  Delete "$INSTDIR\icons\calendar.ico"
  Delete "$INSTDIR\icons\contacts.ico"
  Delete "$INSTDIR\icons\tasks.ico"
  Delete "$SMPROGRAMS\Mirra Office\Mirra Mail.lnk"
  Delete "$DESKTOP\Mirra Mail.lnk"
  RMDir "$SMPROGRAMS\Mirra Office"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro NEXORA_APP_REMOVE "Orbit"
  !insertmacro NEXORA_APP_REMOVE "Nexora Text"
  !insertmacro NEXORA_APP_REMOVE "Nexora Tabellen"
  !insertmacro NEXORA_APP_REMOVE "Nexora Pr${U+00E4}sentation"
  !insertmacro NEXORA_APP_REMOVE "Nexora Kalender"
  !insertmacro NEXORA_APP_REMOVE "Nexora Kontakte"
  !insertmacro NEXORA_APP_REMOVE "Nexora Aufgaben"
  RMDir "$SMPROGRAMS\Nexora"
  Delete "$INSTDIR\components.ini"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey HKLM "${NEXORA_KEY}"
  ${EndIf}
!macroend

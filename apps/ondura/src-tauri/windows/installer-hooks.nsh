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
Var OnduraDefault
Var OnduraDefaultBox

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
  ; Offered on a fresh installation; updates keep what the user has chosen.
  StrCpy $OnduraDefault 0
  ClearErrors
  ReadRegStr $0 HKLM "${ONDURA_KEY}" "Mail"
  ${If} ${Errors}
    StrCpy $OnduraDefault 1
  ${EndIf}
FunctionEnd

Function OnduraComponentsPage
  Call SkipIfPassive
  Call OnduraDefaults
  !insertmacro MUI_HEADER_TEXT "$(OnduraAppsTitle)" "$(OnduraAppsSubtitle)"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateCheckbox} 0 0 100% 12u "Ondura Mail"
  Pop $OnduraMailBox
  ${NSD_CreateLabel} 14u 13u -14u 20u "$(OnduraMailText)"
  Pop $0
  ${NSD_CreateCheckbox} 0 40u 100% 12u "$(OnduraOfficeApps)"
  Pop $OnduraOfficeBox
  ${NSD_CreateLabel} 14u 53u -14u 20u "$(OnduraOfficeText)"
  Pop $0
  ${NSD_CreateLabel} 0 80u 100% 20u "$(OnduraAppsHint)"
  Pop $0
  ${NSD_CreateCheckbox} 0 108u 100% 12u "$(OnduraDefaultApps)"
  Pop $OnduraDefaultBox
  ${NSD_CreateLabel} 14u 121u -14u 20u "$(OnduraDefaultAppsText)"
  Pop $0
  ${If} $OnduraDefault == 1
    ${NSD_Check} $OnduraDefaultBox
  ${EndIf}
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
    MessageBox MB_ICONEXCLAMATION|MB_OK "$(OnduraAppsNone)"
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
  ${NSD_GetState} $OnduraDefaultBox $0
  StrCpy $OnduraDefault 0
  ${If} $0 == ${BST_CHECKED}
    StrCpy $OnduraDefault 1
  ${EndIf}
FunctionEnd

; Default apps. Since Windows 8 an app may not make itself the default; it
; registers what it can open ("Capabilities", listed under RegisteredApplications)
; so it appears in Settings › Apps › Default apps, where the user confirms.
!define ONDURA_CAPS "${ONDURA_KEY}\Capabilities"

!macro ONDURA_CAP_FILE EXT CLASS
  WriteRegStr HKLM "${ONDURA_CAPS}\FileAssociations" ".${EXT}" "${CLASS}"
!macroend

!macro ONDURA_REGISTER_CAPABILITIES
  DeleteRegKey HKLM "${ONDURA_CAPS}"
  WriteRegStr HKLM "${ONDURA_CAPS}" "ApplicationName" "Ondura"
  WriteRegStr HKLM "${ONDURA_CAPS}" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKLM "${ONDURA_CAPS}" "ApplicationDescription" "$(OnduraCapsText)"
  ${If} $OnduraOffice == 1
    !insertmacro ONDURA_CAP_FILE "docx" "Ondura.Text.docx"
    !insertmacro ONDURA_CAP_FILE "odt" "Ondura.Text.odt"
    !insertmacro ONDURA_CAP_FILE "xlsx" "Ondura.Tabellen.xlsx"
    !insertmacro ONDURA_CAP_FILE "ods" "Ondura.Tabellen.ods"
    !insertmacro ONDURA_CAP_FILE "pptx" "Ondura.Praesentation.pptx"
    !insertmacro ONDURA_CAP_FILE "odp" "Ondura.Praesentation.odp"
    !insertmacro ONDURA_CAP_FILE "pdf" "Ondura.PDF.pdf"
    !insertmacro ONDURA_CAP_FILE "drawio" "Ondura.Diagramme.drawio"
    !insertmacro ONDURA_CAP_FILE "ondform" "Ondura.Formulare.ondform"
  ${EndIf}
  DeleteRegKey HKLM "Software\Classes\Ondura.Mail.mailto"
  ${If} $OnduraMail == 1
    ; mailto: links open a new message in Ondura Mail (`--mailto <link>`).
    WriteRegStr HKLM "Software\Classes\Ondura.Mail.mailto" "" "$(OnduraMailtoName)"
    WriteRegStr HKLM "Software\Classes\Ondura.Mail.mailto" "URL Protocol" ""
    WriteRegStr HKLM "Software\Classes\Ondura.Mail.mailto\DefaultIcon" "" "$INSTDIR\icons\mail.ico,0"
    WriteRegStr HKLM "Software\Classes\Ondura.Mail.mailto\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" --mailto "%1"'
    WriteRegStr HKLM "${ONDURA_CAPS}\URLAssociations" "mailto" "Ondura.Mail.mailto"
  ${EndIf}
  WriteRegStr HKLM "Software\RegisteredApplications" "Ondura" "${ONDURA_CAPS}"
!macroend

; Opens Ondura's page in Settings › Default apps (Windows 11; Windows 10 opens
; the default apps overview). Interactive installations only.
!macro ONDURA_OFFER_DEFAULTS
  ${If} $OnduraDefault == 1
  ${AndIfNot} ${Silent}
  ${AndIf} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
    ExecShell "open" "ms-settings:defaultapps?registeredAppMachine=Ondura"
  ${EndIf}
!macroend

; AppUserModelID of a shortcut: the same id as the app's windows
; (windows.rs `app_user_model_id`), so pinned shortcuts and open windows share
; one taskbar button per app. Same steps as SetLnkAppUserModelId in utils.nsh.
!macro ONDURA_SET_AUMID SHORTCUT AUMID
  !insertmacro ComHlpr_CreateInProcInstance ${CLSID_ShellLink} ${IID_IShellLink} r0 ""
  ${If} $0 P<> 0
    ${IUnknown::QueryInterface} $0 '("${IID_IPersistFile}",.r1)'
    ${If} $1 P<> 0
      ${IPersistFile::Load} $1 '("${SHORTCUT}", ${STGM_READWRITE})'
      ${IUnknown::QueryInterface} $0 '("${IID_IPropertyStore}",.r2)'
      ${If} $2 P<> 0
        System::Call 'Oleaut32::SysAllocString(w "${AUMID}") i.r3'
        System::Call '*${SYSSTRUCT_PROPERTYKEY}(${PKEY_AppUserModel_ID})p.r4'
        System::Call '*${SYSSTRUCT_PROPVARIANT}(${VT_BSTR},,&i4 $3)p.r5'
        ${IPropertyStore::SetValue} $2 '($4,$5)'
        System::Call 'Oleaut32::SysFreeString($3)'
        System::Free $4
        System::Free $5
        ${IPropertyStore::Commit} $2 ""
        ${IUnknown::Release} $2 ""
        ${IPersistFile::Save} $1 '("${SHORTCUT}",1)'
      ${EndIf}
      ${IUnknown::Release} $1 ""
    ${EndIf}
    ${IUnknown::Release} $0 ""
  ${EndIf}
!macroend

!macro ONDURA_APP_SHORTCUT NAME ID
  CreateShortcut "$SMPROGRAMS\Ondura\${NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app ${ID}" "$INSTDIR\icons\${ID}.ico" 0
  !insertmacro ONDURA_SET_AUMID "$SMPROGRAMS\Ondura\${NAME}.lnk" "${BUNDLEID}.${ID}"
  CreateShortcut "$DESKTOP\${NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" "--app ${ID}" "$INSTDIR\icons\${ID}.ico" 0
  !insertmacro ONDURA_SET_AUMID "$DESKTOP\${NAME}.lnk" "${BUNDLEID}.${ID}"
!macroend

!macro ONDURA_DOC_ICON CLASS ID
  WriteRegStr SHCTX "Software\Classes\${CLASS}\DefaultIcon" "" "$INSTDIR\icons\${ID}.ico,0"
!macroend

!macro ONDURA_APP_REMOVE NAME
  Delete "$SMPROGRAMS\Ondura\${NAME}.lnk"
  Delete "$DESKTOP\${NAME}.lnk"
!macroend

; Shortcut names in every installer language (the language may change
; between installations).
!macro ONDURA_OFFICE_REMOVE
  !insertmacro ONDURA_APP_REMOVE "Ondura Text"
  !insertmacro ONDURA_APP_REMOVE "Ondura Texte"
  !insertmacro ONDURA_APP_REMOVE "Ondura Tabellen"
  !insertmacro ONDURA_APP_REMOVE "Ondura Sheets"
  !insertmacro ONDURA_APP_REMOVE "Ondura Tableur"
  !insertmacro ONDURA_APP_REMOVE "Ondura Pr${U+00E4}sentation"
  !insertmacro ONDURA_APP_REMOVE "Ondura Slides"
  !insertmacro ONDURA_APP_REMOVE "Ondura Pr${U+00E9}sentation"
  !insertmacro ONDURA_APP_REMOVE "Ondura PDF"
  !insertmacro ONDURA_APP_REMOVE "Ondura Notizen"
  !insertmacro ONDURA_APP_REMOVE "Ondura Notes"
  !insertmacro ONDURA_APP_REMOVE "Ondura Planer"
  !insertmacro ONDURA_APP_REMOVE "Ondura Planner"
  !insertmacro ONDURA_APP_REMOVE "Ondura Planificateur"
  !insertmacro ONDURA_APP_REMOVE "Ondura Diagramme"
  !insertmacro ONDURA_APP_REMOVE "Ondura Diagrams"
  !insertmacro ONDURA_APP_REMOVE "Ondura Diagrammes"
  !insertmacro ONDURA_APP_REMOVE "Ondura Formulare"
  !insertmacro ONDURA_APP_REMOVE "Ondura Forms"
  !insertmacro ONDURA_APP_REMOVE "Ondura Formulaires"
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
  !insertmacro ONDURA_OFFICE_REMOVE
  ${If} $OnduraOffice == 1
    !insertmacro ONDURA_APP_SHORTCUT "$(OnduraNameText)" "text"
    !insertmacro ONDURA_APP_SHORTCUT "$(OnduraNameSheets)" "sheets"
    !insertmacro ONDURA_APP_SHORTCUT "$(OnduraNameSlides)" "slides"
    !insertmacro ONDURA_APP_SHORTCUT "Ondura PDF" "pdf"
    !insertmacro ONDURA_APP_SHORTCUT "$(OnduraNameNotes)" "notes"
    !insertmacro ONDURA_APP_SHORTCUT "$(OnduraNamePlanner)" "planner"
    !insertmacro ONDURA_APP_SHORTCUT "$(OnduraNameDiagram)" "diagram"
    !insertmacro ONDURA_APP_SHORTCUT "$(OnduraNameForms)" "forms"
    ; Tauri registers every file type with the suite icon; documents show the
    ; icon of the app that opens them instead (written after Tauri's keys).
    !insertmacro ONDURA_DOC_ICON "Ondura.Text.docx" "text"
    !insertmacro ONDURA_DOC_ICON "Ondura.Text.odt" "text"
    !insertmacro ONDURA_DOC_ICON "Ondura.Tabellen.xlsx" "sheets"
    !insertmacro ONDURA_DOC_ICON "Ondura.Tabellen.ods" "sheets"
    !insertmacro ONDURA_DOC_ICON "Ondura.Praesentation.pptx" "slides"
    !insertmacro ONDURA_DOC_ICON "Ondura.Praesentation.odp" "slides"
    !insertmacro ONDURA_DOC_ICON "Ondura.PDF.pdf" "pdf"
    !insertmacro ONDURA_DOC_ICON "Ondura.Diagramme.drawio" "diagram"
    !insertmacro ONDURA_DOC_ICON "Ondura.Formulare.ondform" "forms"
    !insertmacro UPDATEFILEASSOC
  ${Else}
    ; Without the office apps Ondura does not open Office files.
    !insertmacro APP_UNASSOCIATE "docx" "Ondura.Text.docx"
    !insertmacro APP_UNASSOCIATE "xlsx" "Ondura.Tabellen.xlsx"
    !insertmacro APP_UNASSOCIATE "pptx" "Ondura.Praesentation.pptx"
    !insertmacro APP_UNASSOCIATE "odt" "Ondura.Text.odt"
    !insertmacro APP_UNASSOCIATE "ods" "Ondura.Tabellen.ods"
    !insertmacro APP_UNASSOCIATE "odp" "Ondura.Praesentation.odp"
    !insertmacro APP_UNASSOCIATE "pdf" "Ondura.PDF.pdf"
    !insertmacro APP_UNASSOCIATE "drawio" "Ondura.Diagramme.drawio"
    !insertmacro APP_UNASSOCIATE "ondform" "Ondura.Formulare.ondform"
    !insertmacro UPDATEFILEASSOC
  ${EndIf}
  !insertmacro ONDURA_SERVICE_INSTALL
  !insertmacro ONDURA_REGISTER_CAPABILITIES
  !insertmacro ONDURA_OFFER_DEFAULTS
  WriteINIStr "$INSTDIR\components.ini" "Apps" "mail" $OnduraMail
  WriteINIStr "$INSTDIR\components.ini" "Apps" "office" $OnduraOffice
  WriteRegStr HKLM "${ONDURA_KEY}" "Mail" $OnduraMail
  WriteRegStr HKLM "${ONDURA_KEY}" "Office" $OnduraOffice
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro ONDURA_SERVICE_STOP
  ${If} $UpdateMode <> 1
    nsExec::Exec '${ONDURA_SC} delete ${ONDURA_SERVICE}'
    Pop $0
  ${EndIf}
  !insertmacro ONDURA_APP_REMOVE "Ondura Mail"
  !insertmacro ONDURA_OFFICE_REMOVE
  RMDir "$SMPROGRAMS\Ondura"
  Delete "$INSTDIR\components.ini"
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegValue HKLM "Software\RegisteredApplications" "Ondura"
    DeleteRegKey HKLM "Software\Classes\Ondura.Mail.mailto"
    DeleteRegKey HKLM "${ONDURA_KEY}"
  ${EndIf}
!macroend

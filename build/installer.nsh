; Installer and uninstaller wording lives here, not in src/shared/i18n/en: NSIS has no access to the app's string table.

; Runs when BarkStudy is uninstalled. The decks and study history are kept unless the person says otherwise, and a silent
; uninstall (winget, /S) or the old-version removal during an update never asks and never deletes.
!macro customUnInstall
  ${ifNot} ${isUpdated}
    ${ifNot} ${Silent}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Also delete your decks and study history?$\r$\n$\r$\nChoose No to keep them, for example if you plan to reinstall BarkStudy." IDNO keepData
      RMDir /r "$APPDATA\BarkStudy"
      keepData:
    ${endIf}
  ${endIf}
!macroend

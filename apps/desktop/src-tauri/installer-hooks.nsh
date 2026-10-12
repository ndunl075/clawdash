!macro NSIS_HOOK_PREUNINSTALL
  ; Remove only Clawdash-owned Claude entries. Never delete user progress.
  nsExec::ExecToLog '"$INSTDIR\clawdash-cli.exe" integrations uninstall claude'
  Pop $0
  StrCmp $0 "0" clawdash_cleanup_done
  MessageBox MB_OK|MB_ICONEXCLAMATION "Clawdash could not remove its Claude hooks. Your settings and progress were preserved. Review the Claude settings backup and remove Clawdash-owned entries using the recovery guide." /SD IDOK
  clawdash_cleanup_done:
!macroend

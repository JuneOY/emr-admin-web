; 安装到当前 Windows 用户，病例目录与应用安装目录独立。
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "FileFunc.nsh"

!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!ifndef BUILD_UNINSTALLER
Var EmrDataDirectory
Var EmrDataInput
Var EmrDataDialog
Var EmrKeepDataLocation

Function EmrDetectExistingData
  StrCpy $EmrKeepDataLocation "0"
  IfFileExists "$APPDATA\emr-admin\data-location.json" emr_keep_data
  IfFileExists "$APPDATA\emr-admin\clinical.sqlite" emr_keep_data
  IfFileExists "$APPDATA\emr-admin\initial-data-location.ini" emr_keep_data emr_new_data
  emr_keep_data:
    StrCpy $EmrKeepDataLocation "1"
  emr_new_data:
FunctionEnd

Function EmrBrowseDataDirectory
  nsDialogs::SelectFolderDialog "选择病例数据存放位置" "$EmrDataDirectory"
  Pop $0
  ${If} $0 != "error"
    StrCpy $EmrDataDirectory $0
    ${NSD_SetText} $EmrDataInput "$EmrDataDirectory"
  ${EndIf}
FunctionEnd

; 此文件早于 MUI2 加载，页面函数须在 builder 的 customHeader 阶段展开。
!macro customHeader
  Function EmrDataPageCreate
    Call EmrDetectExistingData
    ; 升级、重装沿用既有配置，在应用内执行完整迁移。
    ${If} $EmrKeepDataLocation == "1"
      Abort
    ${EndIf}
    ${If} $EmrDataDirectory == ""
      StrCpy $EmrDataDirectory "$DOCUMENTS\门诊病历数据"
    ${EndIf}
    !insertmacro MUI_HEADER_TEXT "选择病例数据存放位置" "选择病例保存位置，然后继续安装。"
    nsDialogs::Create 1018
    Pop $EmrDataDialog
    ${If} $EmrDataDialog == "error"
      Abort
    ${EndIf}
    ${NSD_CreateLabel} 0 0 100% 30u "患者、病例、处方库和检查附件将保存在这里。安装完成后，也可以在本地设置中迁移到其他位置。"
    Pop $0
    ${NSD_CreateLabel} 0 42u 100% 12u "病例数据文件夹："
    Pop $0
    ${NSD_CreateText} 0 60u 78% 14u "$EmrDataDirectory"
    Pop $EmrDataInput
    ${NSD_CreateButton} 80% 60u 20% 14u "浏览…"
    Pop $0
    ${NSD_OnClick} $0 EmrBrowseDataDirectory
    ${NSD_CreateLabel} 0 88u 100% 30u "请选择本机磁盘中的空文件夹。软件升级和卸载会保留病例数据。"
    Pop $0
    nsDialogs::Show
  FunctionEnd
!macroend

Function EmrValidateDataDirectory
  StrCpy $0 $EmrDataDirectory 2 1
  ${If} $0 != ":\"
    MessageBox MB_OK "请选择本机磁盘中的完整文件夹路径。"
    Abort
  ${EndIf}
  GetFullPathName $EmrDataDirectory "$EmrDataDirectory"
  ${GetRoot} "$EmrDataDirectory" $0
  ${If} $EmrDataDirectory == "$0\"
    MessageBox MB_OK "请创建独立文件夹，不要直接选择磁盘根目录。"
    Abort
  ${EndIf}
  System::Call 'kernel32::GetDriveTypeW(w "$0\") i.r1'
  ${If} $1 != 3
    MessageBox MB_OK "请选择本机固定磁盘中的文件夹。"
    Abort
  ${EndIf}
  ; 不能把病例放入安装目录，也不能让安装目录成为病例目录的子目录。
  StrLen $0 "$INSTDIR\"
  StrCpy $1 "$EmrDataDirectory\" $0
  ${If} $1 == "$INSTDIR\"
    MessageBox MB_OK "病例数据目录与软件安装目录需要分别存放。"
    Abort
  ${EndIf}
  StrLen $0 "$EmrDataDirectory\"
  StrCpy $1 "$INSTDIR\" $0
  ${If} $1 == "$EmrDataDirectory\"
    MessageBox MB_OK "请选择软件安装目录以外的独立文件夹。"
    Abort
  ${EndIf}
  StrLen $0 "$APPDATA\emr-admin\"
  StrCpy $1 "$EmrDataDirectory\" $0
  ${If} $1 == "$APPDATA\emr-admin\"
    MessageBox MB_OK "请选择应用配置目录以外的病例文件夹。"
    Abort
  ${EndIf}
  FindFirst $0 $1 "$EmrDataDirectory\*"
  emr_check_entry:
    ${If} $1 == ""
      Goto emr_empty_directory
    ${EndIf}
    ${If} $1 != "."
    ${AndIf} $1 != ".."
      FindClose $0
      MessageBox MB_OK "这个文件夹已有文件，请选择一个空文件夹。"
      Abort
    ${EndIf}
    FindNext $0 $1
    Goto emr_check_entry
  emr_empty_directory:
    FindClose $0
  ClearErrors
  CreateDirectory "$EmrDataDirectory"
  IfErrors emr_directory_error
  GetTempFileName $0 "$EmrDataDirectory"
  IfErrors emr_directory_error
  Delete "$0"
  Return
  emr_directory_error:
    MessageBox MB_OK "无法写入这个文件夹，请检查磁盘空间和文件夹权限。"
    Abort
FunctionEnd

Function EmrDataPageLeave
  ${NSD_GetText} $EmrDataInput $EmrDataDirectory
  Call EmrValidateDataDirectory
FunctionEnd

!macro customPageAfterChangeDir
  Page custom EmrDataPageCreate EmrDataPageLeave
!macroend

!macro customInstall
  Call EmrDetectExistingData
  ${If} $EmrKeepDataLocation != "1"
    ${If} $EmrDataDirectory == ""
      StrCpy $EmrDataDirectory "$DOCUMENTS\门诊病历数据"
    ${EndIf}
    Call EmrValidateDataDirectory
    ; UTF-16 保留中文路径；仅首次安装写入，后续目录指针由应用管理。
    CreateDirectory "$APPDATA\emr-admin"
    ClearErrors
    FileOpen $0 "$APPDATA\emr-admin\initial-data-location.ini.tmp" w
    IfErrors emr_write_location_error
    FileWriteWord $0 0xFEFF
    FileWriteUTF16LE $0 "[Storage]$\r$\nDirectory=$EmrDataDirectory$\r$\n"
    FileClose $0
    IfErrors emr_write_location_error
    Rename "$APPDATA\emr-admin\initial-data-location.ini.tmp" "$APPDATA\emr-admin\initial-data-location.ini"
    IfErrors emr_write_location_error
    Goto emr_write_location_done
    emr_write_location_error:
      MessageBox MB_OK "病例数据目录配置写入失败，请检查当前用户的文件夹权限。"
      Abort
    emr_write_location_done:
  ${EndIf}
!macroend
!endif

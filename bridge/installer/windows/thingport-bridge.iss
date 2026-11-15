#define MyAppName "Thingport Bridge"
#ifndef MyAppVersion
  #define MyAppVersion "dev"
#endif
#define MyAppPublisher "Thingport"
#define MyAppURL "https://thingport.net/"
#define MyAppExeName "thingport-bridge.exe"

[Setup]
AppId={{22E9C080-DF0A-4315-805E-F82DEF88D0B1}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}docs/bridge/
AppUpdatesURL={#MyAppURL}docs/bridge/#update
DefaultDirName={localappdata}\Programs\{#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes
CloseApplications=yes
CloseApplicationsFilter={#MyAppExeName}
RestartApplications=no
Uninstallable=yes
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\thingport.ico
OutputDir=..\..\dist
OutputBaseFilename=thingport-bridge-windows-amd64-setup
SetupIconFile=assets\thingport.ico
LicenseFile=..\..\..\LICENSE
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Setup
VersionInfoProductName={#MyAppName}
VersionInfoProductTextVersion={#MyAppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"
Name: "ukrainian"; MessagesFile: "compiler:Languages\Ukrainian.isl"
Name: "belarusian"; MessagesFile: "languages\Belarusian.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "lithuanian"; MessagesFile: "compiler:Languages\Lithuanian.isl"
Name: "chinese"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[CustomMessages]
LegacyExeRemovalFailed=The previous Bridge executable could not be removed. Close Thingport Bridge and remove this file manually:
russian.LegacyExeRemovalFailed=Не удалось удалить предыдущий файл Bridge. Закройте Thingport Bridge и удалите этот файл вручную:
ukrainian.LegacyExeRemovalFailed=Не вдалося видалити попередній файл Bridge. Закрийте Thingport Bridge й видаліть цей файл вручну:
belarusian.LegacyExeRemovalFailed=Не ўдалося выдаліць папярэдні файл Bridge. Закрыйце Thingport Bridge і выдаліце гэты файл уручную:
spanish.LegacyExeRemovalFailed=No se pudo eliminar el archivo anterior de Bridge. Cierre Thingport Bridge y elimine este archivo manualmente:
french.LegacyExeRemovalFailed=Impossible de supprimer l’ancien fichier Bridge. Fermez Thingport Bridge et supprimez ce fichier manuellement :
lithuanian.LegacyExeRemovalFailed=Nepavyko pašalinti ankstesnio „Bridge“ failo. Uždarykite „Thingport Bridge“ ir pašalinkite šį failą rankiniu būdu:
chinese.LegacyExeRemovalFailed=无法删除旧版 Bridge 文件。请关闭 Thingport Bridge，然后手动删除该文件：

[Files]
Source: "..\..\dist\thingport-bridge-windows-amd64.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
Source: "assets\thingport.ico"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Classes\Applications\{#MyAppExeName}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#MyAppName}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\thingport"; ValueType: string; ValueName: ""; ValueData: "URL:{#MyAppName}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\thingport"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\thingport\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\thingport.ico,0"
Root: HKCU; Subkey: "Software\Classes\thingport\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  LegacyDir: String;
  LegacyExe: String;
begin
  if CurStep = ssPostInstall then
  begin
    LegacyDir := ExpandConstant('{localappdata}\Thingport\Bridge');
    if CompareText(LegacyDir, ExpandConstant('{app}')) <> 0 then
    begin
      LegacyExe := LegacyDir + '\thingport-bridge.exe';
      if FileExists(LegacyExe) and not DeleteFile(LegacyExe) then
        MsgBox(CustomMessage('LegacyExeRemovalFailed') + #13#10 + LegacyExe, mbError, MB_OK);
      RemoveDir(LegacyDir);
    end;
  end;
end;

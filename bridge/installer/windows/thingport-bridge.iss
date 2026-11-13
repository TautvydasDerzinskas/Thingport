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

[Files]
Source: "..\..\dist\thingport-bridge-windows-amd64.exe"; DestDir: "{app}"; DestName: "{#MyAppExeName}"; Flags: ignoreversion
Source: "assets\thingport.ico"; DestDir: "{app}"; Flags: ignoreversion

[Registry]
Root: HKCU; Subkey: "Software\Classes\thingport"; ValueType: string; ValueName: ""; ValueData: "URL:{#MyAppName}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\thingport"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\thingport\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\thingport.ico,0"
Root: HKCU; Subkey: "Software\Classes\thingport\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#MyAppExeName}"" ""%1"""

[Code]
procedure CurStepChanged(CurStep: TSetupStep);
var
  LegacyDir: String;
begin
  if CurStep = ssPostInstall then
  begin
    LegacyDir := ExpandConstant('{localappdata}\Thingport\Bridge');
    DeleteFile(LegacyDir + '\thingport-bridge.exe');
    RemoveDir(LegacyDir);
  end;
end;

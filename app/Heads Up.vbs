' Heads Up launcher: starts the helper in the background (it quits by itself if one is already
' running) and opens the app in the computer's default browser: as its own app window when that
' browser can do one (Edge, Chrome, Brave, Vivaldi), otherwise as a normal tab (Firefox and others).
' Test with:  cscript //nologo "Heads Up.vbs" /dry [/browser:<open command, with | for quotes>]
Option Explicit
Dim sh, fso, appDir, node, url, dry, override, i, arg, cmdLine, exe, exeName, launch, edge
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://127.0.0.1:5178/"
dry = False
override = ""
For i = 0 To WScript.Arguments.Count - 1
  arg = WScript.Arguments(i)
  If LCase(arg) = "/dry" Then dry = True
  If LCase(Left(arg, 9)) = "/browser:" Then override = Replace(Mid(arg, 10), "|", """")   ' tests write | for quotes
Next

node = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(node) Then node = "node"
edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

' The default browser's open command, e.g.  "C:\...\chrome.exe" --single-argument %1
cmdLine = override
If cmdLine = "" Then
  On Error Resume Next
  cmdLine = sh.RegRead("HKCR\" & sh.RegRead("HKCU\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice\ProgId") & "\shell\open\command\")
  On Error GoTo 0
End If
exe = ""
If Left(cmdLine, 1) = """" Then
  If InStr(2, cmdLine, """") > 2 Then exe = Mid(cmdLine, 2, InStr(2, cmdLine, """") - 2)
ElseIf cmdLine <> "" Then
  exe = Split(cmdLine, " ")(0)
End If
exeName = LCase(fso.GetFileName(exe))
If exeName <> "" And override = "" And Not fso.FileExists(exe) Then exeName = ""

Select Case exeName
  Case "msedge.exe", "chrome.exe", "brave.exe", "vivaldi.exe", "chromium.exe"
    launch = """" & exe & """ --app=" & url & " --window-size=1360,920"
  Case ""
    If fso.FileExists(edge) Then
      launch = """" & edge & """ --app=" & url & " --window-size=1360,920"
    Else
      launch = url
    End If
  Case Else
    launch = url   ' a normal tab in the default browser
End Select

If dry Then
  WScript.Echo launch
  WScript.Quit
End If

sh.CurrentDirectory = appDir
sh.Run """" & node & """ """ & appDir & "\server.js""", 0, False
WScript.Sleep 800
sh.Run launch, 1, False

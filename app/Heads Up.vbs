' Heads Up launcher: starts the helper in the background (it quits by itself if one is
' already running) and opens the app in its own Microsoft Edge window.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
appDir = fso.GetParentFolderName(WScript.ScriptFullName)

node = "C:\Program Files\nodejs\node.exe"
If Not fso.FileExists(node) Then node = "node"
edge = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If Not fso.FileExists(edge) Then edge = "msedge"

sh.CurrentDirectory = appDir
sh.Run """" & node & """ """ & appDir & "\server.js""", 0, False
WScript.Sleep 800
sh.Run """" & edge & """ --app=http://127.0.0.1:5178/ --window-size=1360,920", 1, False

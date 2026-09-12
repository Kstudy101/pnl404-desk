Option Explicit
Dim shell, command, result
If WScript.Arguments.Count <> 3 Then WScript.Quit 1
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = WScript.Arguments(2)
command = Chr(34) & WScript.Arguments(0) & Chr(34) & " " & Chr(34) & WScript.Arguments(1) & Chr(34) & " --deploy"
' WindowStyle 0 hides the process. WaitOnReturn True preserves the real exit.
result = shell.Run(command, 0, True)
WScript.Quit result

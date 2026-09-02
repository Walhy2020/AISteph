param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$sourcePath = Join-Path $projectRoot "tools\hotkey\AIStephHotkey.cs"
if (-not $OutputPath) {
  $OutputPath = Join-Path $projectRoot "bin\AIStephHotkey.exe"
}
$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$compilerCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$compiler = $compilerCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $compiler) {
  throw "未找到 Windows C# 编译器 csc.exe"
}

& $compiler /nologo /target:winexe /optimize+ /utf8output /out:$OutputPath /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll $sourcePath
if ($LASTEXITCODE -ne 0) {
  throw "快捷键助手编译失败，退出码：$LASTEXITCODE"
}
Write-Output $OutputPath
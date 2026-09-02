param(
  [string]$Configuration = "Release",
  [string]$Runtime = "win-x64"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$clientProject = Join-Path $projectRoot "client\AIStephVoice\AIStephVoice.csproj"
$outputRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "dist\AIStephVoice"))
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $projectRoot "dist")) + [IO.Path]::DirectorySeparatorChar
if (-not ($outputRoot + [IO.Path]::DirectorySeparatorChar).StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
  throw "发布目录超出项目 dist 范围"
}
if (Test-Path -LiteralPath $outputRoot) {
  Remove-Item -LiteralPath $outputRoot -Recurse -Force
}

$dotnet = Join-Path $env:ProgramFiles "dotnet\dotnet.exe"
if (-not (Test-Path -LiteralPath $dotnet)) { throw "未找到 .NET 8 SDK" }
& $dotnet publish $clientProject --configuration $Configuration --runtime $Runtime --self-contained true --output $outputRoot /p:PublishSingleFile=true /p:IncludeNativeLibrariesForSelfExtract=true /p:DebugType=None /p:DebugSymbols=false
if ($LASTEXITCODE -ne 0) { throw "AISteph Voice 发布失败，退出码：$LASTEXITCODE" }

$runtimeRoot = Join-Path $outputRoot "runtime"
New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
foreach ($commandName in @("node", "ffmpeg", "ffprobe")) {
  $command = Get-Command $commandName -ErrorAction Stop
  Copy-Item -LiteralPath $command.Source -Destination (Join-Path $runtimeRoot ([IO.Path]::GetFileName($command.Source))) -Force
}

$readme = @"
AISteph Voice

双击 AIStephVoice.exe 即可启动软件和录音服务。
Ctrl + Alt + R 开始或停止录音。
关闭主窗口后软件继续在系统托盘运行。
"@
[IO.File]::WriteAllText((Join-Path $outputRoot "使用说明.txt"), $readme, [Text.UTF8Encoding]::new($true))
Write-Output (Join-Path $outputRoot "AIStephVoice.exe")
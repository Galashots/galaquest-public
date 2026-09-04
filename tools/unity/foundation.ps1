[CmdletBinding()]
param(
    [ValidateSet('validate', 'test', 'build-windows', 'build-webgl', 'all')]
    [string] $Action = 'all'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$project = Join-Path $repo 'unity\GalaQuest'
$unityVersion = '6000.3.23f1'
$localRoot = Join-Path $repo '.local\unity'
$logRoot = Join-Path $localRoot 'logs'
$testRoot = Join-Path $localRoot 'tests'
$buildRoot = Join-Path $localRoot 'builds'
$reviewRoot = Join-Path $localRoot 'review-pack'

foreach ($directory in @($logRoot, $testRoot, $buildRoot, $reviewRoot)) {
    New-Item -ItemType Directory -Force -Path $directory | Out-Null
}

if (-not (Test-Path -LiteralPath (Join-Path $project 'ProjectSettings\ProjectVersion.txt'))) {
    throw "Unity project metadata is missing: $project"
}

function Invoke-Unity {
    param(
        [Parameter(Mandatory = $true)] [string[]] $Arguments
    )

    & unity @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Unity command failed with exit code $LASTEXITCODE: unity $($Arguments -join ' ')"
    }
}

if ($Action -in @('validate', 'all')) {
    $log = Join-Path $logRoot 'validate.log'
    Invoke-Unity @('--no-banner', 'run', $project, '--editor-version', $unityVersion, '--timeout', '300', '--', '-nographics', '-logFile', $log, '-executeMethod', 'GalaQuest.Editor.FoundationBuild.Validate')
}

if ($Action -in @('test', 'all')) {
    Invoke-Unity @('--no-banner', 'test', $project, '--editor-version', $unityVersion, '--mode', 'EditMode', '--timeout', '600', '--output', (Join-Path $testRoot 'editmode.xml'), '--', '-nographics')
    Invoke-Unity @('--no-banner', 'test', $project, '--editor-version', $unityVersion, '--mode', 'PlayMode', '--timeout', '600', '--output', (Join-Path $testRoot 'playmode.xml'), '--', '-nographics')
}

if ($Action -in @('build-windows', 'all')) {
    $output = Join-Path $buildRoot 'windows\GalaQuest.exe'
    $log = Join-Path $logRoot 'windows-build.log'
    Invoke-Unity @('--no-banner', 'build', $project, '--editor-version', $unityVersion, '--target', 'StandaloneWindows64', '--output-path', $output, '--log-file', $log, '--provenance-path', (Join-Path $reviewRoot 'windows-build-provenance.json'), '--args', '-burst-disable-compilation', '--timeout', '900')
}

if ($Action -in @('build-webgl', 'all')) {
    # WebGL cannot use the CLI's built-in 'build' verb: it answers
    #   "Target WebGL has no built-in command-line build. Pass --execute-method, or use a Unity 6+
    #    build profile with --profile. Only desktop targets build without them."
    # and exits 2 without writing a log, which is why this gate has been reporting as
    # "not completed" rather than failing loudly. Drive it through the project's own
    # FoundationBuild.BuildWebGL entry point instead, which honours -buildOutput.
    $output = Join-Path $buildRoot 'webgl'
    $log = Join-Path $logRoot 'webgl-build.log'
    Invoke-Unity @('--no-banner', 'run', $project, '--editor-version', $unityVersion, '--timeout', '3000', '--', '-nographics', '-logFile', $log, '-executeMethod', 'GalaQuest.Editor.FoundationBuild.BuildWebGL', '-buildOutput', $output)
}

Write-Output "GalaQuest Unity foundation action '$Action' passed. Evidence is under $localRoot."

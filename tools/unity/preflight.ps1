<#
.SYNOPSIS
    Deterministically answer "can I drive the GalaQuest Unity Editor right now?"

.DESCRIPTION
    Fresh agents repeatedly fail to locate or attach to Unity. This reports each
    prerequisite separately so the failing one is named instead of inferred, and
    exits non-zero on the first real failure.

    It contains no machine-local paths: the Editor is discovered through the
    official Unity CLI and the project is resolved from this script's own
    checked-in location, so it travels with the repository.
#>
[CmdletBinding()]
param(
    # Start the pinned Editor when no connected instance owns this checkout.
    [switch] $Start,
    # Seconds to wait for a started Editor to finish importing and compiling.
    [int] $ReadyTimeoutSeconds = 1800
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$project = Join-Path $repo 'unity\GalaQuest'
$versionFile = Join-Path $project 'ProjectSettings\ProjectVersion.txt'

function Report {
    param([string] $Check, [string] $Status, [string] $Detail)
    Write-Output ('{0,-22} {1,-8} {2}' -f $Check, $Status, $Detail)
}

function Fail {
    param([string] $Check, [string] $Detail, [string] $Fix)
    Report $Check 'FAIL' $Detail
    Write-Output ''
    Write-Output "Next step: $Fix"
    exit 1
}

# The pinned version is the project's own, never a value copied into guidance.
if (-not (Test-Path -LiteralPath $versionFile)) {
    Fail 'project' "ProjectVersion.txt is missing under $project" `
        'Confirm this script is running from a GalaQuest checkout.'
}
$pinned = ((Get-Content -LiteralPath $versionFile | Select-String '^m_EditorVersion:').Line -split ':\s*', 2)[1].Trim()
Report 'project' 'PASS' $project
Report 'pinned-version' 'PASS' $pinned

if (-not (Get-Command unity -ErrorAction SilentlyContinue)) {
    Fail 'unity-cli' 'The official Unity CLI is not on PATH' `
        'Install the Unity CLI, then re-run. Do not guess an Editor path.'
}
Report 'unity-cli' 'PASS' (& unity --version)

$editors = (& unity editors -i --format json | ConvertFrom-Json).data
$match = $editors | Where-Object { $_.version -eq $pinned }
if (-not $match) {
    Fail 'pinned-editor' "No installed Editor reports $pinned (found: $(($editors.version) -join ', '))" `
        "Install $pinned through Unity Hub or 'unity install $pinned'."
}
Report 'pinned-editor' 'PASS' $match[0].location

function Get-OwnedInstance {
    $status = & unity status --format json | ConvertFrom-Json
    if (-not $status.data.instances) { return $null }
    return $status.data.instances | Where-Object { $_.project -eq $project } | Select-Object -First 1
}

$instance = Get-OwnedInstance
if (-not $instance) {
    if (-not $Start) {
        Fail 'connected-editor' "No connected Editor owns $project" `
            'Re-run with -Start, or attach the Editor already open on this checkout.'
    }
    Report 'connected-editor' 'START' 'Opening the pinned Editor on this checkout'
    # Keep the build target pinned: switching it later invalidates imports and build cache.
    Start-Process -FilePath 'unity' -ArgumentList @(
        '--no-banner', '--non-interactive', 'open', $project,
        '--editor-version', $pinned, '--build-target', 'WebGL'
    ) -WindowStyle Hidden | Out-Null
}

# 'unity status' reports an instance as ready while it is still importing, so
# readiness is taken from the Editor itself rather than from the process list.
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
$ready = $null
while ((Get-Date) -lt $deadline) {
    $probe = & unity command editor_status --timeout 60 --format json 2>$null | ConvertFrom-Json
    if ($probe.success) {
        $result = $probe.data.result
        if ($result.projectPath -ne $project) {
            Fail 'editor-identity' "A connected Editor owns $($result.projectPath), not this checkout" `
                'Target the intended checkout, or close the competing Editor before continuing.'
        }
        if (-not $result.compiling -and -not $result.domainReloadInProgress) { $ready = $result; break }
    }
    Start-Sleep -Seconds 5
}
if (-not $ready) {
    Fail 'editor-ready' "The Editor did not reach a ready state within $ReadyTimeoutSeconds s" `
        'Inspect the Editor log for Safe Mode, a compile error, or a still-running import.'
}

Report 'editor-identity' 'PASS' $ready.projectPath
Report 'editor-ready' 'PASS' "unity $($ready.unityVersion), playMode=$($ready.playMode)"

$errors = (& unity command get_console_logs --severity error --limit 50 --timeout 60 --format json | ConvertFrom-Json).data.result
Report 'console-errors' $(if ($errors.total -gt 0) { 'WARN' } else { 'PASS' }) "$($errors.total) error entries"

Write-Output ''
Write-Output "Preflight passed. Drive this Editor with 'unity command <tool>'; 'unity list' shows what it exposes."

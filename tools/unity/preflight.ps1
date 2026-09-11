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

    Every Editor query names the resolved project with --project-path, so a
    different Editor that happens to be connected can never answer for this
    checkout. This script never closes an Editor it does not own.
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

. (Join-Path $PSScriptRoot 'preflight-lib.ps1')

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

# Capture stdout without letting a non-zero CLI exit become a terminating error:
# a failed response must be classified, not thrown.
function Invoke-UnityCli {
    param([string[]] $Arguments)
    try {
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        return (& unity @Arguments 2>&1 | Out-String)
    } catch {
        return ''
    } finally {
        $ErrorActionPreference = $previous
    }
}

# The pinned version is the project's own, never a value copied into guidance.
if (-not (Test-Path -LiteralPath $versionFile)) {
    Fail 'project' "ProjectVersion.txt is missing under $project" `
        'Confirm this script is running from a GalaQuest checkout.'
}
$pinnedLine = Get-Content -LiteralPath $versionFile | Select-String '^m_EditorVersion:'
if (-not $pinnedLine) {
    Fail 'pinned-version' 'ProjectVersion.txt has no m_EditorVersion line' `
        'Repair the Unity project metadata before continuing.'
}
$pinned = ($pinnedLine.Line -split ':\s*', 2)[1].Trim()
Report 'project' 'PASS' $project
Report 'pinned-version' 'PASS' $pinned

if (-not (Get-Command unity -ErrorAction SilentlyContinue)) {
    Fail 'unity-cli' 'The official Unity CLI is not on PATH' `
        'Install the Unity CLI, then re-run. Do not guess an Editor path.'
}
Report 'unity-cli' 'PASS' (& unity --version)

$editorsResponse = Read-UnityCliResponse -Text (Invoke-UnityCli @('editors', '-i', '--format', 'json'))
if (-not $editorsResponse.Ok) {
    Fail 'pinned-editor' "Could not list installed Editors: $($editorsResponse.Reason)" `
        'Run "unity editors -i" directly and resolve the CLI error it reports.'
}
$match = $editorsResponse.Value.data | Where-Object { $_.version -eq $pinned }
if (-not $match) {
    $found = ($editorsResponse.Value.data.version) -join ', '
    Fail 'pinned-editor' "No installed Editor reports $pinned (found: $found)" `
        "Install $pinned through Unity Hub or 'unity install $pinned'."
}
Report 'pinned-editor' 'PASS' $match[0].location

# --project-path selects the Editor owning this checkout. A connected Editor on a
# different project answers "no Pipeline instance found" rather than standing in.
$statusArgs = @('command', 'editor_status', '--project-path', $project, '--timeout', '60', '--format', 'json')

$probe = Test-UnityEditorReady -ResponseText (Invoke-UnityCli $statusArgs) -Project $project -PinnedVersion $pinned
if (-not $probe.Ok -and -not $probe.Retryable -and -not $probe.Result) {
    if (-not $Start) {
        Fail 'connected-editor' "No ready Editor answered for this checkout: $($probe.Reason)" `
            'Re-run with -Start, or attach the Editor already open on this checkout.'
    }
    Report 'connected-editor' 'START' 'Opening the pinned Editor on this checkout'
    Start-Process -FilePath 'unity' -ArgumentList (Get-UnityOpenArguments -Project $project -PinnedVersion $pinned) -WindowStyle Hidden | Out-Null
}

$deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
$ready = $null
$lastReason = $probe.Reason
while ((Get-Date) -lt $deadline) {
    $probe = Test-UnityEditorReady -ResponseText (Invoke-UnityCli $statusArgs) -Project $project -PinnedVersion $pinned
    if ($probe.Ok) { $ready = $probe.Result; break }
    $lastReason = $probe.Reason
    # A wrong project or wrong version never becomes right by waiting.
    if (-not $probe.Retryable -and $probe.Result) {
        Fail 'editor-identity' $probe.Reason `
            'Target the intended checkout, or let the competing Editor be closed by whoever owns it.'
    }
    Start-Sleep -Seconds 5
}
if (-not $ready) {
    Fail 'editor-ready' "The Editor did not become ready within $ReadyTimeoutSeconds s: $lastReason" `
        'Inspect the Editor log for Safe Mode, a compile error, or a still-running import.'
}

Report 'editor-identity' 'PASS' "$($ready.projectPath) @ $($ready.unityVersion)"
Report 'editor-ready' 'PASS' "status=$($ready.status), playMode=$($ready.playMode)"

# Console state is reported, not gated: a connected-gameplay limitation in this
# project is not a reason for the tooling preflight to refuse to run.
$consoleResponse = Read-UnityCliResponse -Text (Invoke-UnityCli @(
        'command', 'get_console_logs', '--project-path', $project,
        '--severity', 'error', '--limit', '50', '--timeout', '60', '--format', 'json'))
if ($consoleResponse.Ok) {
    $errors = $consoleResponse.Value.data.result
    Report 'console-errors' $(if ($errors.total -gt 0) { 'WARN' } else { 'PASS' }) "$($errors.total) error entries (inspect before trusting gameplay evidence)"
} else {
    Report 'console-errors' 'UNKNOWN' $consoleResponse.Reason
}

Write-Output ''
Write-Output "Preflight passed. Drive this Editor with 'unity command <tool> --project-path `"$project`"'; 'unity list' shows what it exposes."

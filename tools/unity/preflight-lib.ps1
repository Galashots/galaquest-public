<#
.SYNOPSIS
    Decision logic for the GalaQuest Unity preflight, separated so it can be
    exercised against controlled CLI responses without a running Editor.

    This file only defines functions. Dot-source it; do not execute it.
#>

Set-StrictMode -Version Latest

# A CLI response is only usable if it parsed AND the CLI reported success.
# Anything else is classified, so a failed or malformed response can never be
# mistaken for a passing check.
function Read-UnityCliResponse {
    param([AllowNull()] [AllowEmptyString()] [string] $Text)

    if ([string]::IsNullOrWhiteSpace($Text)) {
        return [pscustomobject]@{ Ok = $false; Value = $null; Reason = 'the Unity CLI returned no output' }
    }
    try {
        $parsed = $Text | ConvertFrom-Json
    } catch {
        return [pscustomobject]@{ Ok = $false; Value = $null; Reason = 'the Unity CLI returned output that is not JSON' }
    }
    if ($null -eq $parsed -or -not ($parsed.PSObject.Properties.Name -contains 'success')) {
        return [pscustomobject]@{ Ok = $false; Value = $null; Reason = 'the Unity CLI response has no success field' }
    }
    if (-not $parsed.success) {
        $message = 'the Unity CLI reported failure'
        if ($parsed.PSObject.Properties.Name -contains 'errors' -and $parsed.errors) {
            $message += ": $($parsed.errors[0].message)"
        }
        return [pscustomobject]@{ Ok = $false; Value = $parsed; Reason = $message }
    }
    return [pscustomobject]@{ Ok = $true; Value = $parsed; Reason = $null }
}

function Compare-ProjectPath {
    param([string] $Left, [string] $Right)

    if ([string]::IsNullOrWhiteSpace($Left) -or [string]::IsNullOrWhiteSpace($Right)) { return $false }
    $normalize = { param($p) $p.Replace('/', '\').TrimEnd('\') }
    return [string]::Equals((& $normalize $Left), (& $normalize $Right), 'OrdinalIgnoreCase')
}

# Readiness is three independent claims: the right Editor answered, it runs the
# version this project pins, and it is actually idle. Each is reported by name.
function Test-UnityEditorReady {
    param(
        [AllowNull()] [AllowEmptyString()] [string] $ResponseText,
        [Parameter(Mandatory = $true)] [string] $Project,
        [Parameter(Mandatory = $true)] [string] $PinnedVersion
    )

    $response = Read-UnityCliResponse -Text $ResponseText
    if (-not $response.Ok) {
        return [pscustomobject]@{ Ok = $false; Retryable = $false; Reason = $response.Reason; Result = $null }
    }

    $result = $response.Value.data.result
    if ($null -eq $result) {
        return [pscustomobject]@{ Ok = $false; Retryable = $false; Reason = 'the Unity CLI response carried no editor status'; Result = $null }
    }

    if (-not (Compare-ProjectPath -Left $result.projectPath -Right $Project)) {
        return [pscustomobject]@{
            Ok = $false; Retryable = $false; Result = $result
            Reason = "the responding Editor owns $($result.projectPath), not this checkout"
        }
    }
    if ($result.unityVersion -ne $PinnedVersion) {
        return [pscustomobject]@{
            Ok = $false; Retryable = $false; Result = $result
            Reason = "the responding Editor is $($result.unityVersion) but this project pins $PinnedVersion"
        }
    }

    # Still-working states are retryable; the caller waits rather than failing.
    if ($result.compiling) {
        return [pscustomobject]@{ Ok = $false; Retryable = $true; Reason = 'the Editor is compiling'; Result = $result }
    }
    if ($result.domainReloadInProgress) {
        return [pscustomobject]@{ Ok = $false; Retryable = $true; Reason = 'a domain reload is in progress'; Result = $result }
    }
    if ($result.status -ne 'ready') {
        return [pscustomobject]@{ Ok = $false; Retryable = $true; Reason = "the Editor reports status '$($result.status)'"; Result = $result }
    }

    return [pscustomobject]@{ Ok = $true; Retryable = $false; Reason = $null; Result = $result }
}

# Start-Process joins ArgumentList into one command line, so a value containing
# spaces must carry its own quotes or it silently becomes two arguments.
function Format-UnityArgument {
    param([Parameter(Mandatory = $true)] [AllowEmptyString()] [string] $Value)

    if ($Value -match '[\s"]') { return '"' + $Value.Replace('"', '\"') + '"' }
    return $Value
}

function Get-UnityOpenArguments {
    param(
        [Parameter(Mandatory = $true)] [string] $Project,
        [Parameter(Mandatory = $true)] [string] $PinnedVersion,
        # Keep the build target pinned: switching it later invalidates imports and build cache.
        [string] $BuildTarget = 'WebGL'
    )

    return @(
        '--no-banner', '--non-interactive', 'open', (Format-UnityArgument $Project),
        '--editor-version', (Format-UnityArgument $PinnedVersion),
        '--build-target', (Format-UnityArgument $BuildTarget)
    )
}

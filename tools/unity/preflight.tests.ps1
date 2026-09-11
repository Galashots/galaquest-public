<#
.SYNOPSIS
    Exercise the preflight decision logic against controlled Unity CLI responses.

.DESCRIPTION
    These cases run without a Unity Editor: each feeds a fixture response to the
    same functions preflight.ps1 uses, so a regression in the readiness contract
    fails here rather than in a machine-specific observation.

    Run: powershell -NoProfile -ExecutionPolicy Bypass -File tools\unity\preflight.tests.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

. (Join-Path $PSScriptRoot 'preflight-lib.ps1')

$script:failures = 0
$script:passes = 0

function Assert {
    param([string] $Name, [bool] $Condition, [string] $Detail = '')
    if ($Condition) {
        $script:passes++
        Write-Output "  PASS  $Name"
    } else {
        $script:failures++
        Write-Output "  FAIL  $Name $Detail"
    }
}

$project = 'C:\checkout\unity\GalaQuest'
$pinned = '6000.3.23f1'

function Status {
    param([string] $ProjectPath = $project, [string] $Version = $pinned, [string] $State = 'ready',
        [bool] $Compiling = $false, [bool] $DomainReload = $false)
    return (@{
            success = $true
            data    = @{ result = @{
                    status                 = $State
                    compiling              = $Compiling
                    domainReloadInProgress = $DomainReload
                    playMode               = 'stopped'
                    projectPath            = $ProjectPath
                    unityVersion           = $Version
                }
            }
        } | ConvertTo-Json -Depth 6)
}

function Check { param([string] $Text) return (Test-UnityEditorReady -ResponseText $Text -Project $project -PinnedVersion $pinned) }

Write-Output 'A correct response is the only thing that passes'
Assert 'ready, right project, right version passes' (Check (Status)).Ok
Assert 'a trailing separator still matches the project' (Check (Status -ProjectPath "$project\")).Ok
Assert 'project path case does not matter on Windows' (Check (Status -ProjectPath $project.ToUpper())).Ok

Write-Output 'A wrong Editor cannot pass, and waiting cannot fix it'
$other = Check (Status -ProjectPath 'C:\somewhere-else\unity\GalaQuest')
Assert 'a competing default Editor cannot answer for this checkout' (-not $other.Ok)
Assert 'the wrong project is not retried' (-not $other.Retryable)
Assert 'the wrong project is named' ($other.Reason -like '*somewhere-else*') $other.Reason

$wrongVersion = Check (Status -Version '6000.2.5f1')
Assert 'a mismatched Editor version cannot pass' (-not $wrongVersion.Ok)
Assert 'a mismatched version is not retried' (-not $wrongVersion.Retryable)
Assert 'both versions are named' (($wrongVersion.Reason -like '*6000.2.5f1*') -and ($wrongVersion.Reason -like "*$pinned*")) $wrongVersion.Reason

Write-Output 'A busy Editor is not ready, but is worth waiting for'
foreach ($case in @(
        @{ Name = 'compiling'; Text = (Status -Compiling $true) },
        @{ Name = 'domain reload'; Text = (Status -DomainReload $true) },
        @{ Name = 'non-ready status'; Text = (Status -State 'importing') }
    )) {
    $busy = Check $case.Text
    Assert "$($case.Name) does not pass" (-not $busy.Ok)
    Assert "$($case.Name) is retryable" $busy.Retryable
}
# The documented predicate is enforced on its own: a 'ready' claim is required
# even when both busy flags are already false.
Assert 'status is enforced independently of the busy flags' (-not (Check (Status -State 'safeMode')).Ok)

Write-Output 'A failed or malformed response is classified, never a pass'
foreach ($case in @(
        @{ Name = 'empty output'; Text = '' },
        @{ Name = 'whitespace output'; Text = "  `n " },
        @{ Name = 'non-JSON output'; Text = 'unity: command not found' },
        @{ Name = 'JSON without success'; Text = '{"data":{"result":{}}}' },
        @{ Name = 'success=false'; Text = '{"success":false,"errors":[{"message":"No Pipeline instance found"}]}' },
        @{ Name = 'success but no result'; Text = '{"success":true,"data":{"result":null}}' }
    )) {
    $bad = Check $case.Text
    Assert "$($case.Name) does not pass" (-not $bad.Ok)
    Assert "$($case.Name) is explained" (-not [string]::IsNullOrWhiteSpace($bad.Reason)) $bad.Reason
}
$cliFailure = Check '{"success":false,"errors":[{"message":"No Pipeline instance found"}]}'
Assert 'a CLI failure quotes the CLI message' ($cliFailure.Reason -like '*No Pipeline instance found*') $cliFailure.Reason

Write-Output 'A spaced project path survives Start-Process argument joining'
$spaced = 'C:\Users\Some One\My Checkout\unity\GalaQuest'
$arguments = Get-UnityOpenArguments -Project $spaced -PinnedVersion $pinned
$commandLine = $arguments -join ' '
Assert 'the spaced path is quoted in the argument list' ($arguments -contains ('"' + $spaced + '"')) $commandLine
# Re-split the joined command line the way a process does: a correctly quoted
# path comes back as exactly one argument.
$reparsed = [regex]::Matches($commandLine, '"[^"]*"|\S+') | ForEach-Object { $_.Value.Trim('"') }
Assert 'the joined command line re-parses the path as one argument' ($reparsed -contains $spaced) ($reparsed -join ' | ')
Assert 'an unspaced value is left unquoted' ((Get-UnityOpenArguments -Project 'C:\plain' -PinnedVersion $pinned) -contains 'C:\plain')
Assert 'the build target stays pinned' ($arguments -contains 'WebGL')

Write-Output ''
Write-Output "preflight logic: $script:passes passed, $script:failures failed"
if ($script:failures -gt 0) { exit 1 }

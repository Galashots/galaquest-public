// Close only the browser spawned for one disposable Unity review, then verify its profile is gone.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, lstatSync, rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const execute = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function assertOwnedBrowserInputs(browser, profile) {
  assert.ok(Number.isInteger(browser?.pid) && browser.pid > 0, 'A spawned browser PID is required');
  assert.equal(dirname(resolve(profile)), resolve(tmpdir()), 'Only a direct OS-temp profile is owned');
  assert.match(basename(profile), /^gq-(?:burst|mixed)-chrome-[A-Za-z0-9]+$/);
  if (existsSync(profile)) assert.equal(lstatSync(profile).isSymbolicLink(), false, 'Do not follow a profile link');
}
export async function cleanupOwnedBrowser(browser, profile) {
  assertOwnedBrowserInputs(browser, profile);
  if (process.platform === 'win32') {
    // Verify current PID identity before using ordinary same-user Windows process control.
    // No broad Chrome kill, elevation, ACL changes, or security-setting changes.
    const script = `
$ErrorActionPreference='Stop'
$ownedPid=[int]$env:GQ_BROWSER_PID
$profile=$env:GQ_BROWSER_PROFILE
$record=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ownedPid)
if($record){
  if($record.Name -ine 'chrome.exe' -or !$record.CommandLine -or $record.CommandLine.IndexOf($profile,[StringComparison]::OrdinalIgnoreCase) -lt 0){throw 'Browser PID identity changed; nothing was stopped'}
  $owned=Get-Process -Id $ownedPid -ErrorAction SilentlyContinue
  if($owned){& taskkill.exe /PID $ownedPid /T /F | Out-Null; if(!$owned.WaitForExit(15000)){throw 'Owned Chrome tree did not exit'}}
}
$remaining=@(Get-CimInstance Win32_Process -Filter "name='chrome.exe'" | Where-Object {$_.CommandLine -and $_.CommandLine.IndexOf($profile,[StringComparison]::OrdinalIgnoreCase) -ge 0})
if($remaining.Count){throw 'An owned-profile Chrome is still alive; profile preserved'}
if(Test-Path -LiteralPath $profile){Remove-Item -LiteralPath $profile -Recurse -Force -ErrorAction Stop}
if(Test-Path -LiteralPath $profile){throw 'Owned profile still exists'}
@{pid=$ownedPid;nativeExitVerified=$true;profileRemoved=$true} | ConvertTo-Json -Compress
`;
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      env: { ...process.env, GQ_BROWSER_PID: String(browser.pid), GQ_BROWSER_PROFILE: profile },
      timeout: 45000, maxBuffer: 1024 * 1024, windowsHide: true,
    });
    const receipt = JSON.parse(stdout.trim());
    assert.equal(receipt.nativeExitVerified, true);
    assert.equal(receipt.profileRemoved, true);
    assert.equal(existsSync(profile), false);
    return receipt;
  }
  if (browser.exitCode === null && browser.signalCode === null) {
    browser.kill();
    await Promise.race([new Promise(resolve => browser.once('exit', resolve)), delay(5000)]);
  }
  assert.ok(browser.exitCode !== null || browser.signalCode !== null, 'Owned browser is still alive');
  rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
  assert.equal(existsSync(profile), false);
  return { pid: browser.pid, nativeExitVerified: true, profileRemoved: true };
}

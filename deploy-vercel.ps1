#Guard: deploy-vercel.ps1 - the ONLY supported entry point for Vercel deploys.
#
#Why this exists (2026-10-17): the project's Root Directory (dashboard setting) is `web`,
#a dashboard build setting resolved RELATIVE to the uploaded tree. The Vercel CLI has no
#per-deploy "use this folder" flag, so the resolution depends entirely on which directory
#`npx vercel` is runnable from:
#
#  run from the repo root  -> the upload contains web/ (the subdir it is) -> the build finds it  -> OK
#  run from inside web/    -> the upload's root IS web/ contents -> web/ is gone    -> the error
#                             "Root Directory "web" does not exist"
#
#The AGENTS.md note to "deploy from web/" predates e83b56f (root-side with .vercelignore)
#and is now corrected. This script makes the right path impossible to get wrong rather
#than only documented: it refuses anything but the repo root, then execs npx vercel with
#the given args.
#
#Usage (untracked helper; not part of the release flow):
#  .\deploy-vercel.ps1            # preview deploy
#  .\deploy-vercel.ps1 --prod     # production deploy (adds --prod --yes)
#
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$VercelArgs)

# always non-interactive: --yes is what keeps a CI/background run from stalling on a prompt
if (-not ($VercelArgs | Where-Object { $_ -in @("--yes", "-y") })) {
  if ($VercelArgs) { Write-Host "adding --yes (non-interactive)" -ForegroundColor DarkYellow }
  $VercelArgs = @($VercelArgs) + "--yes"
}

if ($IsWindows -or $env:OS -eq "Windows_NT") { $vercel = "npx.cmd" } else { $vercel = "npx" }

#1) must be the repo root (deploy-vercel.ps1 lives here; anything else -> refuse)
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([System.IO.Path]::GetFullPath((Get-Location).Path) -ne $scriptDir) {
  Write-Host "REFUSED: run from the repo root ($scriptDir)." -ForegroundColor Red
  Write-Host "why: Vercel's Root Directory is a build setting resolved against the upload, so" -ForegroundColor Red
  Write-Host "     run from inside web/ would make web/ vanish from the upload root." -ForegroundColor Red
  Write-Host "     See AGENTS.md 'Frontend (web/)'." -ForegroundColor Red
  exit 1
}

#2) needs a project link -> refuse with the fix, not a broken deploy
if (-not (Test-Path (Join-Path $scriptDir ".vercel\project.json"))) {
  Write-Host "REFUSED: no .vercel/project.json here. Run once:" -ForegroundColor Red
  Write-Host "  npx vercel link --project irmarket --yes" -ForegroundColor Yellow
  exit 1
}

#3) needs a buildable web/ (the Root Directory setting depends on it)
if (-not (Test-Path (Join-Path $scriptDir "web\package.json"))) {
  Write-Host "REFUSED: web/package.json missing -> the Root Directory 'web' could not be found." -ForegroundColor Red
  exit 1
}

Write-Host "deploy from repo root: $scriptDir (args: $($VercelArgs -join ' '))"
& $vercel vercel @VercelArgs
if ($LASTEXITCODE -ne 0) {
  Write-Host "vercel exited $LASTEXITCODE" -ForegroundColor Red
}
exit $LASTEXITCODE

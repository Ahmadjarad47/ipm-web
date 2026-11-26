<#
.SYNOPSIS
  Deploys the current working trees of ipm-web and ipm-backend (including uncommitted changes) to the server.

.EXAMPLE
  .\deploy.ps1                  # test, back up the database, deploy web + api
  .\deploy.ps1 -Target web      # front end only
  .\deploy.ps1 -Target api      # back end only
  .\deploy.ps1 -SkipTests       # deploy without running the local tests
  .\deploy.ps1 -DryRun          # test and package only; the server is not contacted
#>
[CmdletBinding()]
param(
    [ValidateSet('all', 'web', 'api')]
    [string]$Target = 'all',
    [switch]$SkipTests,
    [switch]$DryRun,
    [string]$Server = 'adp101@192.168.88.40',
    [string]$Url = 'https://192.168.88.40:8445'
)

$ErrorActionPreference = 'Stop'

# This script lives in ipm-web; ipm-backend is its sibling folder.
$webDir = $PSScriptRoot
$root = Split-Path $webDir -Parent
$backendDir = Join-Path $root 'ipm-backend'
$archive = Join-Path $env:TEMP 'ipm.tgz'
$remoteFile = Join-Path $env:TEMP 'deploy-remote.sh'
$tar = Join-Path $env:SystemRoot 'System32\tar.exe'

function Write-Step([string]$Text) {
    Write-Host "`n==> $Text" -ForegroundColor Cyan
}

# Native programs do not throw in PowerShell, so every call goes through this check.
function Invoke-Checked([string]$What, [scriptblock]$Command) {
    & $Command
    if ($LASTEXITCODE -ne 0) { throw "$What failed (exit code $LASTEXITCODE). Deploy stopped." }
}

if (-not (Test-Path $backendDir)) { throw "Backend folder not found: $backendDir" }

if (-not $SkipTests) {
    if ($Target -ne 'api') {
        Write-Step 'Web: tests and production build'
        Push-Location $webDir
        try {
            Invoke-Checked 'Web tests' { npx ng test --watch=false }
            Invoke-Checked 'Web build' { npx ng build }
        }
        finally { Pop-Location }
    }
    if ($Target -ne 'web') {
        Write-Step 'Backend: tests (Docker Desktop must be running)'
        # Only the exit code matters here; cmd keeps Docker's error text out of PowerShell.
        cmd /c 'docker info >nul 2>nul'
        if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running. Start it, or use -SkipTests.' }
        # Run from the backend folder: its global.json picks the .NET SDK. From elsewhere a newer SDK is used and the build fails.
        Push-Location $backendDir
        try { Invoke-Checked 'Backend tests' { dotnet test Ipm.slnx } }
        finally { Pop-Location }
    }
}

Write-Step 'Packaging the sources'
if (Test-Path $archive) { Remove-Item $archive -Force }
Invoke-Checked 'Packaging' {
    & $tar --exclude=node_modules --exclude=bin --exclude=obj --exclude=dist --exclude=.angular `
        --exclude=.git --exclude=.vs --exclude=.env --exclude=.claude --exclude=TestResults `
        -czf $archive -C $root ipm-web ipm-backend
}
Write-Host ('Package: {0} ({1:N1} MB)' -f $archive, ((Get-Item $archive).Length / 1MB))

# The part that runs on the server. Server-only files (docker-compose.yml, Caddyfile, .env) are never touched.
$remote = @'
#!/usr/bin/env bash
set -euo pipefail
target="$1"
url="$2"
cd "$HOME/ipm"

case "$target" in
  web) services="web";     folders="ipm-web" ;;
  api) services="api";     folders="ipm-backend" ;;
  all) services="api web"; folders="ipm-web ipm-backend" ;;
  *) echo "Unknown target: $target" >&2; exit 2 ;;
esac

echo "--> Backing up the database"
mkdir -p backups
chmod 700 backups
backup="backups/ipm-$(date -u +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$backup"
echo "    $backup"
ls -1t backups/ipm-*.sql.gz | tail -n +11 | xargs -r rm -f   # keep the newest 10

echo "--> Keeping the running images as :previous"
for s in $services; do
  if docker image inspect "ipm-$s:prod" >/dev/null 2>&1; then
    docker tag "ipm-$s:prod" "ipm-$s:previous"
  fi
done

echo "--> Replacing the sources"
# Unpack aside first, then swap, so files deleted on the PC do not stay on the server.
rm -rf stage
mkdir stage
tar xzf ipm.tgz -C stage
for f in $folders; do
  test -f "stage/$f/Dockerfile"
  rm -rf "$f"
  mv "stage/$f" "$f"
done
rm -rf stage

echo "--> Building: $services (the running version stays up meanwhile)"
docker compose build $services

echo "--> Restarting"
docker compose up -d $services
# nginx in "web" resolves the api address only at start, so restart it after replacing the api alone.
if [ "$target" = "api" ]; then docker compose restart web; fi

echo "--> Health check"
for i in $(seq 1 40); do
  site=$(curl -ks -o /dev/null -w '%{http_code}' --max-time 5 "$url/" || true)
  # An empty login request must be rejected with 400: that proves the API answers through the proxy.
  api=$(curl -ks -o /dev/null -w '%{http_code}' --max-time 5 -H 'Content-Type: application/json' -d '{}' "$url/api/v1/auth/login" || true)
  if [ "$site" = "200" ] && [ "$api" = "400" ]; then
    docker compose ps
    echo "OK: site $site, api $api"
    exit 0
  fi
  sleep 3
done

echo "FAILED: site $site (expected 200), api $api (expected 400)" >&2
docker compose ps
docker compose logs --tail 60 api
echo "To go back to the previous images (this does NOT undo database migrations):" >&2
for s in $services; do echo "  docker tag ipm-$s:previous ipm-$s:prod" >&2; done
echo "  docker compose up -d --no-build $services && docker compose restart web" >&2
exit 1
'@

# Bash needs LF line endings and no BOM.
[System.IO.File]::WriteAllText($remoteFile, ($remote -replace "`r`n", "`n"), (New-Object System.Text.UTF8Encoding $false))

if ($DryRun) {
    Write-Step 'Dry run: nothing was uploaded'
    Write-Host "Server script: $remoteFile"
    return
}

Write-Step "Uploading to $Server"
Invoke-Checked 'Upload' { scp $archive $remoteFile "${Server}:ipm/" }

Write-Step "Deploying '$Target' on the server"
Invoke-Checked 'Server deploy' { ssh $Server "bash ~/ipm/deploy-remote.sh $Target $Url" }

Write-Step "Done: $Url"
Write-Host 'Reload the browser with Ctrl+Shift+R to see the new version.'

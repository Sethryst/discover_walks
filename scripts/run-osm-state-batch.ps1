param(
    [string[]] $States = @('MD', 'NC', 'FL', 'CA'),
    [string] $Release = 'osm-us-2026-09-07',
    [string] $Root = '.gremlin-osm',
    [switch] $IncludePoi,
    [switch] $PublishSupabase,
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $RemainingStates
)

$ErrorActionPreference = 'Stop'
$workspace = (Get-Location).Path
$relativeLogDirectory = Join-Path -Path $Root -ChildPath (Join-Path -Path 'logs' -ChildPath $Release)
$logDirectory = Join-Path -Path $workspace -ChildPath $relativeLogDirectory
New-Item -ItemType Directory -Force -Path $logDirectory | Out-Null

$requestedStates = @(@($States) + @($RemainingStates) | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (-not $requestedStates) {
    throw 'Provide at least one state code via -States.'
}
$batchFailed = $false

foreach ($state in $requestedStates) {
    $log = Join-Path $logDirectory "$state.log"
    $stateSucceeded = $true
    Write-Host "[$(Get-Date -Format o)] Starting $state; log: $log"
    & "$PSScriptRoot/osm-state.ps1" build-state $state --release $Release --root $Root --no-upload --keep-source 2>&1 |
        Tee-Object -FilePath $log
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "$state failed. Its source/intermediates were retained for diagnosis. Continuing with the next state."
        $stateSucceeded = $false
        $batchFailed = $true
    }
    else {
        & "$PSScriptRoot/osm-state.ps1" validate-state $state --release $Release --root $Root 2>&1 |
            Tee-Object -FilePath $log -Append
        if ($LASTEXITCODE -ne 0) {
            $stateSucceeded = $false
            $batchFailed = $true
            Write-Warning "$state built but validation failed. Continuing without claiming success."
        }
    }
    if ($IncludePoi) {
        Write-Host "[$(Get-Date -Format o)] Starting independent POI build for $state"
        & "$PSScriptRoot/osm-state.ps1" build-poi-state $state --release $Release --root $Root --no-upload --keep-source 2>&1 |
            Tee-Object -FilePath $log -Append
        if ($LASTEXITCODE -ne 0) {
            $stateSucceeded = $false
            $batchFailed = $true
            Write-Warning "$state POI build failed; roadway output remains independently valid."
        }
        else {
            & "$PSScriptRoot/osm-state.ps1" validate-state $state --product poi --release $Release --root $Root 2>&1 |
                Tee-Object -FilePath $log -Append
            if ($LASTEXITCODE -ne 0) {
                $stateSucceeded = $false
                $batchFailed = $true
                Write-Warning "$state POI validation failed; inputs were retained."
            }
        }
    }
    if ($stateSucceeded) {
        & "$PSScriptRoot/osm-state.ps1" cleanup-state $state --release $Release --root $Root 2>&1 |
            Tee-Object -FilePath $log -Append
    }
}

if ($PublishSupabase) {
    & "$PSScriptRoot/osm-state.ps1" publish-release @requestedStates --release $Release --root $Root 2>&1 |
        Tee-Object -FilePath (Join-Path $logDirectory 'supabase-publish.log')
    if ($LASTEXITCODE -ne 0) {
        $batchFailed = $true
        Write-Warning 'Supabase publishing failed; local validated PMTiles were retained for retry.'
    }
}

& "$PSScriptRoot/osm-state.ps1" validate-release --release $Release --root $Root 2>&1 |
    Tee-Object -FilePath (Join-Path $logDirectory 'release-validation.log')
if ($LASTEXITCODE -ne 0) { $batchFailed = $true }
if ($batchFailed) { exit 1 }
exit 0

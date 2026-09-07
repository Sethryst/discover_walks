param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]] $CommandArgs
)

$workspace = (Get-Location).Path
$portableWorkspace = $workspace.Replace('\', '/')
$linuxWorkspace = (wsl -e wslpath -a $portableWorkspace).Trim()
if (-not $linuxWorkspace) {
    throw "Could not translate the workspace path for WSL."
}
wsl --cd $linuxWorkspace python3 -m app.pipeline.osm_state_cli @CommandArgs
exit $LASTEXITCODE

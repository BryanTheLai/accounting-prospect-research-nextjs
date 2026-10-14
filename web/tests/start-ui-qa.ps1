$ErrorActionPreference = 'Stop'
$webDirectory = Split-Path -Parent $PSScriptRoot
$fixturePath = [IO.Path]::GetFullPath((Join-Path $webDirectory '../operations/ui-qa/fixture.db'))
if (-not (Test-Path -LiteralPath $fixturePath)) { throw 'Run node tests/create-ui-fixture.mjs first.' }
Set-Location -LiteralPath $webDirectory
# Use Next directly: local.mjs would also start a dispatcher and load mailbox env.
$env:OUTBOUNDER_DB_PATH = $fixturePath
$env:ENABLE_LIVE_DISPATCH = 'false'
$env:OUTBOUNDER_CONTROL_TOKEN = 'QA_NO_DISPATCH'
$env:OUTBOUNDER_DISPATCHER_PORT = '65534'
$env:SMTP_USER = ''
$env:SMTP_PASSWORD = ''
node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3001

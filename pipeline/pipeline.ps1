# SPDX-License-Identifier: MIT
# Windows equivalent of `make pipeline`. GNU make is not installed on Windows by
# default, and the Makefile is kept for CI and Unix checkouts.
#
#   powershell -File pipeline.ps1            full run
#   powershell -File pipeline.ps1 -Clean     drop the cache first, cold run
#
# Works under Windows PowerShell 5.1 and PowerShell 7+ (pwsh).

param([switch]$Clean)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if ($Clean) {
    Write-Host "== clean" -ForegroundColor Cyan
    foreach ($d in "raw", "extracted", "cache", "tokenizers") {
        $p = Join-Path ".." "data\$d"
        if (Test-Path $p) { Remove-Item -Recurse -Force $p }
    }
}

Write-Host "== setup" -ForegroundColor Cyan
uv python install 3.12
if ($LASTEXITCODE -ne 0) { throw "uv python install failed" }
uv sync
if ($LASTEXITCODE -ne 0) { throw "uv sync failed" }

Write-Host "== fetch" -ForegroundColor Cyan
uv run python -c "from src import corpora; corpora.fetch_flores(); corpora.fetch_massive()"
if ($LASTEXITCODE -ne 0) { throw "corpus fetch failed" }

# Measurement and provenance gates run before the export, so the pipeline fails
# rather than writing numbers it cannot stand behind.
Write-Host "== measurement and provenance gates" -ForegroundColor Cyan
uv run pytest tests/test_gates.py tests/test_provenance.py
if ($LASTEXITCODE -ne 0) { throw "gates failed - not exporting" }

Write-Host "== export" -ForegroundColor Cyan
uv run python -m src.build
if ($LASTEXITCODE -ne 0) { throw "export failed" }

# Documents render from what was just exported, then are checked against it.
Write-Host "== render documents" -ForegroundColor Cyan
uv run python -m src.render_docs
if ($LASTEXITCODE -ne 0) { throw "document rendering failed" }

Write-Host "== full suite" -ForegroundColor Cyan
uv run pytest
if ($LASTEXITCODE -ne 0) { throw "verification failed" }

Write-Host "pipeline complete" -ForegroundColor Green

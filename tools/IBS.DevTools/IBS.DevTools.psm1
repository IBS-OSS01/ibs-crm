function New-IBSDocument {

    [CmdletBinding()]
    param(
        [Parameter(Mandatory)]
        [ValidateSet(
            "Core",
            "Product",
            "Architecture",
            "Module",
            "API",
            "Database",
            "AI",
            "Security",
            "Standards",
            "Decision",
            "Knowledge"
        )]
        [string]$Type,

        [Parameter(Mandatory)]
        [string]$Name
    )

    $map = @{
        Core         = ".\docs\Core"
        Product      = ".\docs\Product"
        Architecture = ".\docs\Architecture"
        Module       = ".\docs\Modules"
        API          = ".\docs\API"
        Database     = ".\docs\Database"
        AI           = ".\docs\AI"
        Security     = ".\docs\Security"
        Standards    = ".\docs\Standards"
        Decision     = ".\docs\Decisions"
        Knowledge    = ".\docs\Knowledge"
    }

    $folder = $map[$Type]

    if (!(Test-Path $folder)) {
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
    }

    $filename = ($Name -replace '[\\/:*?"<>|]', '') -replace '\s+', '_'
    $file = Join-Path $folder "$filename.md"

    @"
# $Name

---

## Metadata

| Property | Value |
|----------|-------|
| Type | $Type |
| Status | Draft |
| Version | 1.0 |

---

## Purpose

_To be defined._

---

## Scope

_To be defined._

---

## Requirements

_To be defined._

---

## References

_To be defined._

"@ | Set-Content $file -Encoding UTF8

    Write-Host ""
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host " IBS Document Created Successfully" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Cyan
    Write-Host "Document : $file"
}

function Test-IBSRepository {

    $checks = @(
        ".git",
        "docs",
        "scripts",
        "tools",
        "src",
        "package.json",
        ".gitignore"
    )

    Write-Host ""
    Write-Host "IBS Repository Validation" -ForegroundColor Cyan
    Write-Host "-------------------------" -ForegroundColor Cyan

    foreach($item in $checks){
        if(Test-Path $item){
            Write-Host "[PASS] $item" -ForegroundColor Green
        }
        else{
            Write-Host "[FAIL] $item" -ForegroundColor Red
        }
    }
}

Export-ModuleMember -Function New-IBSDocument,Test-IBSRepository

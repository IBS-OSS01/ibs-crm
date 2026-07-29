function New-IBSDocument {

    param(
        [Parameter(Mandatory)]
        [string]$Type,

        [Parameter(Mandatory)]
        [string]$Name
    )

    switch ($Type.ToLower()) {

        "module" {
            $folder = ".\docs\Modules"
            $prefix = "MOD"
        }

        "api" {
            $folder = ".\docs\API"
            $prefix = "API"
        }

        "database" {
            $folder = ".\docs\Database"
            $prefix = "DB"
        }

        "architecture" {
            $folder = ".\docs\Architecture"
            $prefix = "ARCH"
        }

        "ai" {
            $folder = ".\docs\AI"
            $prefix = "AI"
        }

        default {
            $folder = ".\docs"
            $prefix = "DOC"
        }
    }

    if (!(Test-Path $folder)) {
        New-Item -ItemType Directory -Force -Path $folder | Out-Null
    }

    $file = Join-Path $folder ($Name.Replace(" ","_") + ".md")

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

## Notes

_To be defined._

"@ | Set-Content $file -Encoding UTF8

    Write-Host ""
    Write-Host "==================================" -ForegroundColor Cyan
    Write-Host " IBS Document Created" -ForegroundColor Green
    Write-Host "==================================" -ForegroundColor Cyan
    Write-Host $file
}

Export-ModuleMember -Function New-IBSDocument
function Initialize-IBSProject {

    Write-Host ""
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host "     IBS Project Health Check" -ForegroundColor Green
    Write-Host "==========================================" -ForegroundColor Cyan
    Write-Host ""

    $checks = @(
        ".git",
        "docs",
        "docs\Core",
        "docs\Modules",
        "docs\Architecture",
        "docs\AI",
        "docs\Database",
        "docs\API",
        "scripts",
        "tools",
        "src",
        "package.json",
        ".gitignore"
    )

    foreach($item in $checks){

        if(Test-Path $item){
            Write-Host "[PASS] $item" -ForegroundColor Green
        }
        else{
            Write-Host "[FAIL] $item" -ForegroundColor Red
        }

    }

    Write-Host ""
    Write-Host "IBS Project Validation Complete."
    Write-Host ""
}

Export-ModuleMember -Function Initialize-IBSProject

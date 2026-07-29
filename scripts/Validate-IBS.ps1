Write-Host ""
Write-Host "========================================="
Write-Host "      IBS Repository Validation"
Write-Host "========================================="
Write-Host ""

$checks = @(
    @{Name="Git Repository"; Test={ Test-Path ".git" }},
    @{Name="Docs Folder"; Test={ Test-Path "docs" }},
    @{Name="Scripts Folder"; Test={ Test-Path "scripts" }},
    @{Name="Tools Folder"; Test={ Test-Path "tools" }},
    @{Name="Templates Folder"; Test={ Test-Path "docs\Templates" }},
    @{Name="Core Docs"; Test={ Test-Path "docs\Core" }},
    @{Name="Architecture Docs"; Test={ Test-Path "docs\Architecture" }},
    @{Name="Modules Docs"; Test={ Test-Path "docs\Modules" }},
    @{Name="GitIgnore"; Test={ Test-Path ".gitignore" }},
    @{Name="Package.json"; Test={ Test-Path "package.json" }},
    @{Name="Firebase Config"; Test={ Test-Path "firebase.json" }}
)

$pass = 0

foreach($item in $checks){
    if(& $item.Test){
        Write-Host "[PASS] $($item.Name)" -ForegroundColor Green
        $pass++
    }
    else{
        Write-Host "[FAIL] $($item.Name)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "$pass / $($checks.Count) Checks Passed"

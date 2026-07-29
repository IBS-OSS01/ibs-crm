Write-Host ""
Write-Host "========================================="
Write-Host "      IBS Repository Health Check"
Write-Host "========================================="
Write-Host ""

$checks = @(
    @{Name="Git Repository"; Test={ Test-Path ".git" }},
    @{Name="Node Modules"; Test={ Test-Path "node_modules" }},
    @{Name="Package.json"; Test={ Test-Path "package.json" }},
    @{Name="Firebase Config"; Test={ Test-Path "src\lib\firebase-config.js" }},
    @{Name="Auth Context"; Test={ Test-Path "src\auth\AuthContext.jsx" }},
    @{Name="useUsers Hook"; Test={ Test-Path "src\lib\useUsers.js" }},
    @{Name="Build Folder"; Test={ Test-Path "dist" }},
    @{Name="Docs"; Test={ Test-Path "docs" }}
)

$pass=0

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

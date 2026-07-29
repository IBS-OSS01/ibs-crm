Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host "      IBS Build • Test • Commit Pipeline" -ForegroundColor Green
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# ---------------------------------
# Validate Repository
# ---------------------------------
if (Get-Command Test-IBSRepository -ErrorAction SilentlyContinue) {
    Test-IBSRepository
}
else {
    Write-Host "[INFO] IBS.DevTools not loaded. Importing..." -ForegroundColor Yellow
    Import-Module .\tools\IBS.DevTools -Force
    if (Get-Command Test-IBSRepository -ErrorAction SilentlyContinue) {
        Test-IBSRepository
    }
}

# ---------------------------------
# Install dependencies
# ---------------------------------
if (Test-Path "package.json") {
    Write-Host ""
    Write-Host "Installing packages..." -ForegroundColor Cyan
    npm install
}

# ---------------------------------
# Build
# ---------------------------------
if (Test-Path "package.json") {
    Write-Host ""
    Write-Host "Building project..." -ForegroundColor Cyan
    npm run build
}

# ---------------------------------
# Run Tests (if configured)
# ---------------------------------
if (Test-Path ".\package.json") {
    $pkg = Get-Content package.json -Raw
    if ($pkg -match '"test"\s*:') {
        Write-Host ""
        Write-Host "Running tests..." -ForegroundColor Cyan
        npm test
    }
    else {
        Write-Host ""
        Write-Host "No test script found. Skipping tests." -ForegroundColor Yellow
    }
}

# ---------------------------------
# Git Status
# ---------------------------------
Write-Host ""
git status

# ---------------------------------
# Commit
# ---------------------------------
$message = Read-Host "Commit Message"

git add .

git commit -m "$message"

# ---------------------------------
# Success
# ---------------------------------
Write-Host ""
Write-Host "=============================================" -ForegroundColor Green
Write-Host "      IBS Pipeline Completed Successfully"
Write-Host "=============================================" -ForegroundColor Green

git log --oneline -5

param(
    [Parameter(Mandatory=$true)]
    [string]$Id,

    [Parameter(Mandatory=$true)]
    [string]$Title,

    [Parameter(Mandatory=$true)]
    [string]$Folder
)

$project = "IBS (India Business Suite)"
$version = "0.1.0"
$status = "Draft"
$date = Get-Date -Format "yyyy-MM-dd"

if (!(Test-Path $Folder)) {
    New-Item -ItemType Directory -Force -Path $Folder | Out-Null
}

$fileName = $Title.Replace(" ","_") + ".md"
$filePath = Join-Path $Folder $fileName

$content = @"
---
Document ID: $Id
Title: $Title
Version: $version
Status: $status
Project: $project
Owner: Chief Software Architect
Created: $date
Last Updated: $date
Reviewers:
Related Documents:
---

# Purpose

# Scope

# Objectives

# Definitions

# Business Requirements

# Functional Requirements

# Non Functional Requirements

# Business Rules

# Actors

# Business Process

# Data Model

# API Considerations

# Security

# AI Opportunities

# Machine Learning Opportunities

# Risks

# Future Scope

# Open Questions

# Version History

| Version | Date | Author | Description |
|---------|------|--------|-------------|
| $version | $date | Chief Software Architect | Initial Draft |
"@

Set-Content -Path $filePath -Value $content -Encoding UTF8

Write-Host ""
Write-Host "====================================="
Write-Host " IBS Document Created Successfully"
Write-Host "====================================="
Write-Host "Document : $filePath"
Write-Host ""

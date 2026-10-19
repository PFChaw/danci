# 一键推送到 GitHub（首次用更方便）
# 用法： powershell -ExecutionPolicy Bypass -File push-to-github.ps1 -Repo https://github.com/you/danci.git
param(
  [Parameter(Mandatory = $true)][string]$Repo,
  [string]$Msg = "背单词工具：更新"
)

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

if (-not (Test-Path .git)) {
  Write-Host "==> 初始化仓库" -ForegroundColor Cyan
  git init -b main | Out-Null
} else {
  Write-Host "==> 已有仓库，直接提交" -ForegroundColor Cyan
}

git add .
git -c user.name="dan ci" -c user.email="noreply@example.com" commit -m $Msg 2>$null
if ($LASTEXITCODE -ne 0) { Write-Host "没有需要提交的改动" -ForegroundColor Yellow }

$hasRemote = git remote 2>$null
if (-not $hasRemote) {
  git remote add origin $Repo
} else {
  git remote set-url origin $Repo
}

Write-Host "==> 推送到 $Repo" -ForegroundColor Cyan
git push -u origin main

Write-Host ""
Write-Host "完成。现在去 Cloudflare Workers & Pages → Create application → Connect GitHub 选这个仓库：" -ForegroundColor Green
Write-Host "  Framework preset = None"
Write-Host "  Build command    = 留空"
Write-Host "  Output directory = /"

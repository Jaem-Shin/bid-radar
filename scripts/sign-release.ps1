# 릴리스 서명 — GitHub Actions가 만든 릴리스(<제품>-v<버전>)의 release.json에 서명하고 release.json.sig를 올린다.
# 사용: sign-release.cmd g2b 0.0.2   (인자 없이 실행하면 물어봄)
# 서명이 올라가야 사용자 PC 자동 업데이트가 그 버전을 받아들인다.
param([string]$Product, [string]$Version)
$ErrorActionPreference = 'Stop'
$Repo = 'Jaem-Shin/bid-radar'
$Ns = 'bid-radar-release'
$key = Join-Path $env:USERPROFILE '.narajangteo-signing\release_key'

function Stop-With($msg) { Write-Host ''; Write-Host "[중단] $msg"; Read-Host '엔터를 누르면 닫힙니다'; exit 1 }

if (-not (Test-Path $key)) { Stop-With '서명 키가 없습니다. 먼저 keygen.cmd를 실행하세요.' }
if (-not $Product) { $Product = Read-Host '제품 (g2b 또는 d2b)' }
$Product = $Product.Trim().ToLower()
if ($Product -notin @('g2b', 'd2b')) { Stop-With "제품은 g2b 또는 d2b 입니다: $Product" }
$Name = "$Product-bid-radar"
if (-not $Version) { $Version = Read-Host '서명할 버전 (예: 0.0.2)' }
$Version = $Version.Trim().TrimStart('v')
if ($Version -notmatch '^\d+\.\d+\.\d+$') { Stop-With "버전 형식이 아닙니다: $Version" }

$Tag = "$Product-v$Version"
$work = Join-Path $env:TEMP "bid-radar-sign-$Tag"
if (Test-Path $work) { Remove-Item $work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $work | Out-Null
$relFile = Join-Path $work 'release.json'
$coreFile = Join-Path $work 'core.mjs'
$sigFile = "$relFile.sig"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$base = "https://github.com/$Repo/releases/download/$Tag"
Write-Host "릴리스 $Tag 내려받는 중..."
try {
  Invoke-WebRequest "$base/release.json" -OutFile $relFile -UseBasicParsing
  Invoke-WebRequest "$base/core.mjs" -OutFile $coreFile -UseBasicParsing
} catch { Stop-With "릴리스 $Tag 파일을 받지 못했습니다. Actions가 끝났는지 확인하세요. ($($_.Exception.Message))" }

$rel = Get-Content $relFile -Raw | ConvertFrom-Json
$hash = (Get-FileHash $coreFile -Algorithm SHA256).Hash.ToLower()
if ($rel.name -ne $Name) { Stop-With "다른 제품의 release.json 입니다: $($rel.name)" }
if ($rel.version -ne $Version) { Stop-With "release.json 버전($($rel.version))이 요청한 버전과 다릅니다" }
if ($rel.sha256 -ne $hash) { Stop-With "core.mjs 체크섬이 release.json과 다릅니다" }

Write-Host ''
Write-Host '---- 서명할 릴리스 ----'
Write-Host "제품      : $($rel.name)"
Write-Host "버전      : $($rel.version)"
Write-Host "core 해시 : $hash (일치 확인됨)"
Write-Host "실행기 요구: $($rel.minLauncher)"
if ($rel.commit) { Write-Host "커밋      : https://github.com/$Repo/commit/$($rel.commit)" }
Write-Host '-----------------------'
Write-Host '내가 올린 버전이 맞을 때만 서명하세요. 서명하면 모든 설치 PC가 이 코드를 받습니다.'
$ok = Read-Host '서명할까요? (Y/N)'
if ($ok -notmatch '^[Yy]') { Stop-With '취소했습니다' }

& ssh-keygen -Y sign -f $key -n $Ns $relFile
if ($LASTEXITCODE -ne 0 -or -not (Test-Path $sigFile)) { Stop-With '서명 실패(암호를 확인하세요)' }

# ssh-keygen은 기존 .sig를 덮어쓰지 않으므로 서명 전에 지운다(위에서 작업 폴더를 비움)
# 서명 자체 검증(cmd 리다이렉트로 원본 바이트 그대로 전달)
cmd /c "ssh-keygen -Y check-novalidate -n $Ns -s `"$sigFile`" < `"$relFile`"" | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-With '만든 서명 검증에 실패했습니다' }
Write-Host '서명 완료.'

# 업로드: gh가 로그인돼 있으면 자동, 아니면 웹 화면에서 끌어다 놓기
$uploaded = $false
if (Get-Command gh -ErrorAction SilentlyContinue) {
  & gh release upload $Tag $sigFile --repo $Repo --clobber
  if ($LASTEXITCODE -eq 0) { $uploaded = $true }
}
if ($uploaded) {
  Write-Host "release.json.sig 를 $Tag 릴리스에 올렸습니다. 설치된 PC들은 다음 확인(최대 6시간) 때 받고, Claude 재시작 시 적용됩니다."
} else {
  Start-Process "https://github.com/$Repo/releases/edit/$Tag"
  Start-Process explorer.exe "/select,`"$sigFile`""
  Write-Host ''
  Write-Host '열린 릴리스 편집 화면 아래 첨부 영역에 release.json.sig 파일을 끌어다 놓고 [Update release]를 누르세요.'
}
Read-Host '엔터를 누르면 닫힙니다'

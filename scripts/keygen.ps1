# 릴리스 서명 키 만들기 — 개발자 PC에서 한 번만. Windows 기본 ssh-keygen 사용.
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:USERPROFILE '.narajangteo-signing'
$key = Join-Path $dir 'release_key'

if (-not (Get-Command ssh-keygen -ErrorAction SilentlyContinue)) {
  Write-Host 'ssh-keygen을 찾을 수 없습니다. 설정 > 앱 > 선택적 기능 > "OpenSSH 클라이언트"를 추가한 뒤 다시 실행하세요.'
  Read-Host '엔터를 누르면 닫힙니다'; exit 1
}

if (Test-Path $key) {
  Write-Host "이미 서명 키가 있습니다: $key"
} else {
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Write-Host '서명 키를 만듭니다.'
  Write-Host '암호(passphrase)를 두 번 입력하세요. 릴리스에 서명할 때마다 필요하고, 잊으면 복구할 수 없습니다.'
  Write-Host ''
  & ssh-keygen -t ed25519 -C bid-radar-release -f $key
  if ($LASTEXITCODE -ne 0) { Write-Host '키 생성 실패'; Read-Host '엔터를 누르면 닫힙니다'; exit 1 }
}

$pub = (Get-Content "$key.pub" -Raw).Trim()
Write-Host ''
Write-Host '[공개 키] 아래 한 줄을 Claude에게 전달하세요(launcher/config.js 의 PUBKEY 에 들어갑니다). 공개해도 안전합니다.'
Write-Host $pub
try { Set-Clipboard -Value $pub; Write-Host '(클립보드에 복사됨)' } catch {}
Write-Host ''
Write-Host "개인 키: $key"
Write-Host '- 이 파일은 USB 등 다른 곳에 백업해 두세요. 잃어버리면 새 키를 넣은 설치 파일을 다시 배포해야 합니다.'
Write-Host '- GitHub·메신저·메일에 절대 올리지 마세요.'
Read-Host '엔터를 누르면 닫힙니다'

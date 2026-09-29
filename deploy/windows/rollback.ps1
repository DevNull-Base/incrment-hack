<#
=============================================================================
 Возврат стенда на прошлый выпуск:

   powershell -File C:\www\incrment\rollback.ps1              # список выпусков
   powershell -File C:\www\incrment\rollback.ps1 -Sha <sha>   # вернуться

 Работает без пересборки: образы прошлых выпусков остаются на сервере
 с тегом по SHA, а статика — в releases\web\<sha>. Поэтому возврат занимает
 секунды и не зависит ни от GitHub, ни от сети.
=============================================================================
#>
[CmdletBinding()]
param(
    [string] $Sha,
    [string] $AppDir = 'C:\www\incrment'
)

$ErrorActionPreference = 'Stop'

# См. пояснение в deploy.ps1: без этого вывод по SSH приходит в кодировке
# консоли Windows и читается как мусор.
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
    # Кодировку задать не удалось — на работу это не влияет.
}

$RepoDir     = Join-Path $AppDir 'repo'
$EnvFile     = Join-Path $AppDir '.env'
$ReleasesDir = Join-Path $AppDir 'releases\web'
$ComposeFile = Join-Path $RepoDir 'deploy\docker-compose.prod.yml'

# Простая функция, а не расширенная: см. пояснение в deploy.ps1. У расширенной
# PowerShell съедает «-d», и compose поднимается в присоединённом режиме,
# после чего откат не завершается.
function Invoke-Compose {
    $composeArgs = @('compose', '-f', $ComposeFile, '--env-file', $EnvFile) + $args
    & docker @composeArgs
    if ($LASTEXITCODE -ne 0) { throw "docker $($composeArgs -join ' ') завершился с кодом $LASTEXITCODE" }
}

if (-not $Sha) {
    $current = Join-Path $AppDir 'current'
    if (Test-Path $current) {
        $target = (Get-Item $current).Target
        Write-Host "Текущий выпуск: $(Split-Path -Leaf $target)"
    } else {
        Write-Host 'Текущий выпуск: не установлен'
    }

    Write-Host "`nДоступные выпуски статики (новые сверху):"
    Get-ChildItem -Path $ReleasesDir -Directory |
        Sort-Object CreationTime -Descending |
        ForEach-Object { Write-Host "  $($_.Name)   $($_.CreationTime.ToString('dd.MM.yyyy HH:mm'))" }

    Write-Host "`nОбразы бэкенда:"
    & docker images --filter reference='incrment/api' --format '  {{.Tag}}  ({{.CreatedSince}}, {{.Size}})'
    exit 0
}

$releaseDir = Join-Path $ReleasesDir $Sha
if (-not (Test-Path $releaseDir)) { throw "Нет статики выпуска $Sha." }

& docker image inspect "incrment/api:$Sha" 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Нет образа incrment/api:$Sha." }

Write-Host "==> Возвращаем бэкенд на $Sha" -ForegroundColor Cyan
$env:IMAGE_TAG = $Sha
Invoke-Compose up -d

Write-Host "==> Возвращаем статику на $Sha" -ForegroundColor Cyan
$link = Join-Path $AppDir 'current'
$temp = Join-Path $AppDir 'current.new'

# Directory.Delete снимает саму точку соединения и не заходит в её цель —
# в отличие от Remove-Item, который в PowerShell 5.1 способен вычистить
# каталог выпуска, на который ссылались.
if (Test-Path $temp) { [System.IO.Directory]::Delete($temp, $false) }
New-Item -ItemType Junction -Path $temp -Target $releaseDir | Out-Null
if (Test-Path $link) { [System.IO.Directory]::Delete($link, $false) }
Move-Item -Path $temp -Destination $link

Set-Content -Path (Join-Path $AppDir '.last-good') -Value $Sha -Encoding ASCII
Write-Host "==> Готово. Текущий выпуск: $Sha" -ForegroundColor Green

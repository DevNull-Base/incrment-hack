<#
=============================================================================
 Создание файла настроек стенда C:\www\incrment\.env.

   powershell -NoProfile -ExecutionPolicy Bypass -File C:\www\incrment\repo\deploy\windows\new-env.ps1

 Берёт образец deploy\env.prod.example и подставляет вместо каждого
 «ЗАМЕНИТЬ_НА_ДЛИННЫЙ_ПАРОЛЬ» свой случайный пароль. Существующий файл
 не трогает: пароли в нём уже разошлись по базам и томам, и замена
 означала бы стенд, который больше не поднимется.

 В конце проверяет то, без чего развёртывание всё равно не пройдёт:
 виден ли Docker и есть ли tar.
=============================================================================
#>
[CmdletBinding()]
param(
    [string] $AppDir = 'C:\www\incrment',
    [string] $RepoDir
)

$ErrorActionPreference = 'Stop'

try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
    # Кодировку задать не удалось — на работу это не влияет.
}

if (-not $RepoDir) { $RepoDir = Join-Path $AppDir 'repo' }

$envFile = Join-Path $AppDir '.env'
$example = Join-Path $RepoDir 'deploy\env.prod.example'

if (Test-Path $envFile) {
    Write-Host "Файл $envFile уже существует — оставляю как есть." -ForegroundColor Yellow
    Write-Host "Чтобы создать заново, сначала переименуйте старый."
    exit 0
}
if (-not (Test-Path $example)) {
    throw "Не найден образец $example. Сначала дождитесь первой доставки исходников либо скопируйте файл вручную."
}

# Только буквы и цифры: доллар в значении docker compose принял бы
# за подстановку переменной, а кавычки и решётки ломают разбор .env.
function New-Password([int] $Length = 28) {
    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $bytes = New-Object 'byte[]' $Length
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
}

$text = [System.IO.File]::ReadAllText($example, [System.Text.Encoding]::UTF8)

# Каждое вхождение заменяется отдельным паролем: общий пароль на базу,
# Keycloak и хранилище означал бы, что утечка одного открывает всё.
$replaced = 0
while ($text -match 'ЗАМЕНИТЬ_НА_ДЛИННЫЙ_ПАРОЛЬ') {
    $index = $text.IndexOf('ЗАМЕНИТЬ_НА_ДЛИННЫЙ_ПАРОЛЬ')
    $text = $text.Remove($index, 'ЗАМЕНИТЬ_НА_ДЛИННЫЙ_ПАРОЛЬ'.Length).Insert($index, (New-Password))
    $replaced++
}

New-Item -ItemType Directory -Force -Path $AppDir | Out-Null

# Без метки порядка байтов: docker compose читает файл построчно, и метка
# в начале превратила бы первый ключ в непонятное ему имя.
[System.IO.File]::WriteAllText($envFile, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Создан $envFile, подставлено паролей: $replaced" -ForegroundColor Green
Write-Host

Write-Host 'Проверьте значения, которые пароля не требуют:' -ForegroundColor Cyan
Select-String -Path $envFile -Pattern '^(PUBLIC_APP_URL|PUBLIC_AUTH_URL|API_BIND_PORT|KEYCLOAK_BIND_PORT|SWAGGER_USER)=' -Encoding UTF8 |
    ForEach-Object { Write-Host ('  ' + $_.Line) }

Write-Host
Write-Host 'Готовность сервера:' -ForegroundColor Cyan

if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker ps --format '{{.Names}}' > $null 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host '  Docker виден и отвечает' -ForegroundColor Green
    } else {
        Write-Host '  Docker установлен, но движок не отвечает.' -ForegroundColor Red
        Write-Host '  Запустите Docker Desktop под той же учётной записью, под которой идёт развёртывание.'
    }
} else {
    Write-Host '  Docker не найден' -ForegroundColor Red
}

if (Get-Command tar -ErrorAction SilentlyContinue) {
    Write-Host '  tar на месте' -ForegroundColor Green
} else {
    Write-Host '  tar не найден — нужен Windows 10 1803+ или Windows Server 2019+' -ForegroundColor Red
}

$busy = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -in 18080, 18081 }
if ($busy) {
    Write-Host '  Порты 18080/18081 заняты — поменяйте API_BIND_PORT и KEYCLOAK_BIND_PORT' -ForegroundColor Red
} else {
    Write-Host '  Порты 18080 и 18081 свободны' -ForegroundColor Green
}

<#
=============================================================================
 Развёртывание стенда на Windows-сервере. Запускается из CI по SSH:

   powershell -NoProfile -ExecutionPolicy Bypass -File C:/www/incrment/deploy.ps1 -Sha <sha>

 Сам скрипт CI копирует в C:\www\incrment\deploy.ps1 — рядом с каталогом
 исходников, а не внутрь него. Иначе получалась бы курица и яйцо: скрипт
 не может распаковать поверх каталога, из которого сам же запущен.

 Порядок шагов не произвольный: сначала поднимается бэкенд и проверяется
 его готовность, и только потом переключается статика. Обратный порядок
 означал бы, что новый интерфейс какое-то время работает со старым API.

 Совместим с Windows PowerShell 5.1 — тем, что стоит в системе по умолчанию.
=============================================================================
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string] $Sha,
    [string] $AppDir = 'C:\www\incrment',
    [int]    $KeepReleases = 5
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # иначе Invoke-WebRequest засоряет журнал CI

# Вывод уходит в журнал CI через SSH. Без явной кодировки Windows отдаёт его
# в кодовой странице консоли (на русской системе — 866), а журнал читает как
# UTF-8: сообщения превращаются в нечитаемый набор знаков ровно тогда, когда
# они нужнее всего — при разборе отказа. В сессии без консоли присвоение
# может не пройти, поэтому оно обёрнуто.
try {
    [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
    $OutputEncoding = [System.Text.Encoding]::UTF8
} catch {
    # Кодировку задать не удалось — на работу это не влияет.
}

$RepoDir     = Join-Path $AppDir 'repo'
$EnvFile     = Join-Path $AppDir '.env'
$UploadsDir  = Join-Path $AppDir 'uploads'
$ReleasesDir = Join-Path $AppDir 'releases\web'
$LastGood    = Join-Path $AppDir '.last-good'
$ComposeFile = Join-Path $RepoDir 'deploy\docker-compose.prod.yml'

function Write-Step([string] $Text) { Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Note([string] $Text) { Write-Host "    $Text" -ForegroundColor DarkGray }

# Значения читаются точечно: в файле есть значения с пробелами (расписание
# регламентной задачи), и разбор «всё подряд» на них спотыкается.
function Read-EnvValue([string] $Key) {
    $match = Select-String -Path $EnvFile -Pattern "^$Key=" -Encoding UTF8 | Select-Object -Last 1
    if (-not $match) { return $null }
    return $match.Line.Substring($Key.Length + 1).Trim().Trim('"')
}

# Простая функция, а не расширенная с ValueFromRemainingArguments.
#
# У расширенной PowerShell разбирает аргументы, начинающиеся с дефиса, как
# имена собственных параметров, и односимвольный «-d» до docker не доезжает:
# массив приходит как [up] [--remove-orphans]. Compose в результате
# поднимается в присоединённом режиме, печатает логи всех контейнеров
# и не завершается никогда — развёртывание висит до отмены задачи.
# В простой функции $args сохраняет аргументы дословно.
function Invoke-Compose {
    $composeArgs = @('compose', '-f', $ComposeFile, '--env-file', $EnvFile) + $args
    & docker @composeArgs
    if ($LASTEXITCODE -ne 0) { throw "docker $($composeArgs -join ' ') завершился с кодом $LASTEXITCODE" }
}

# Скачивание образа — самая дешёвая проверка того, что обращение к реестру
# вообще работает. Строгий режим на время вызова снимается: вывод нативной
# команды в поток ошибок иначе сам становится ошибкой, и проверка потеряла бы
# смысл — падала бы всегда.
function Test-RegistryAccess([string] $Image) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & docker pull $Image | Out-Null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}

# Обращение к пробе с разбором ответа: важен не только сам факт отказа,
# но и код с телом — по ним видно, не поднялся процесс или отказала
# зависимость. Код 0 означает, что ответа не было вовсе.
function Get-Probe([int] $Port, [string] $Path) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "http://127.0.0.1:$Port$Path"
        return [pscustomobject]@{ Code = [int] $response.StatusCode; Body = $response.Content }
    } catch {
        $code = 0
        $body = $_.Exception.Message
        $failed = $_.Exception.Response
        if ($failed) {
            try { $code = [int] $failed.StatusCode } catch { $code = 0 }
            try {
                $reader = New-Object System.IO.StreamReader($failed.GetResponseStream())
                $body = $reader.ReadToEnd()
                $reader.Close()
            } catch {
                # Тело прочитать не удалось — останется текст исключения.
            }
        }
        return [pscustomobject]@{ Code = $code; Body = $body }
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}

function Show-ComposeState {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try { & docker compose -f $ComposeFile --env-file $EnvFile ps } catch { Write-Note 'состояние получить не удалось' }
    finally { $ErrorActionPreference = $previousPreference }
}

# Пробы готовности идут каждые десять секунд и вытесняют из журнала всё
# остальное, поэтому при разборе отказа они отсеиваются: нужны последние
# осмысленные строки, а не свидетельство того, что проверка работает.
function Show-ApiLog {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $lines = & docker compose -f $ComposeFile --env-file $EnvFile logs --tail 300 api
        $lines |
            Where-Object { $_ -notmatch '/health/(live|ready)' } |
            Select-Object -Last 40 |
            ForEach-Object { Write-Host $_ }
    } catch {
        Write-Note 'журнал получить не удалось'
    } finally {
        $ErrorActionPreference = $previousPreference
    }
}

# Удаление самой точки соединения, без захода в каталог, на который она
# указывает. Remove-Item в Windows PowerShell 5.1 в этом месте способен
# вычистить содержимое цели — то есть удалить выпуск, на который ссылались.
# Вызов .NET снимает именно ссылку: RemoveDirectory на точке соединения
# не трогает содержимое цели.
function Remove-Junction([string] $Path) {
    if (Test-Path $Path) { [System.IO.Directory]::Delete($Path, $false) }
}

# Точка соединения (junction), а не символическая ссылка: symlink на Windows
# требует прав администратора либо режима разработчика, junction — нет,
# а Caddy проходит по ней одинаково.
function Set-CurrentRelease([string] $Target) {
    $link = Join-Path $AppDir 'current'
    $temp = Join-Path $AppDir 'current.new'

    Remove-Junction $temp
    New-Item -ItemType Junction -Path $temp -Target $Target | Out-Null

    # Между снятием старой ссылки и переименованием новой проходят
    # доли миллисекунды. Полностью атомарной замены каталога Windows
    # не даёт, и это единственное место, где выпуск виден не целиком.
    Remove-Junction $link
    Move-Item -Path $temp -Destination $link
}

# ----------------------------------------------------------------- Проверки --
# Проверяется только то, что не зависит от доставленных исходников.
# Настройки — ниже, уже после распаковки: иначе на чистом сервере скрипт
# требовал бы файл, а средство его создать лежало бы в нераспакованном архиве.

Write-Step 'Проверяем окружение сервера'

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Docker недоступен. Проверьте, что Docker Desktop запущен и виден пользователю службы SSH.'
}
if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw 'Не найден tar. Нужен Windows 10 1803+ или Windows Server 2019+.'
}

$sourceArchive = Join-Path $UploadsDir "src-$Sha.tar.gz"
$webArchive    = Join-Path $UploadsDir "web-$Sha.tar.gz"
if (-not (Test-Path $sourceArchive)) { throw "Нет архива исходников $sourceArchive." }
if (-not (Test-Path $webArchive))    { throw "Нет архива статики $webArchive." }

# -------------------------------------------------------------- Исходники ---

Write-Step 'Обновляем исходники'
if (Test-Path $RepoDir) { Remove-Item -Recurse -Force $RepoDir }
New-Item -ItemType Directory -Force -Path $RepoDir | Out-Null
& tar -xzf $sourceArchive -C $RepoDir
if ($LASTEXITCODE -ne 0) { throw 'Не удалось распаковать архив исходников.' }

# Вспомогательные скрипты кладём рядом с настройками: они должны работать
# и тогда, когда каталог исходников испорчен неудачной доставкой.
Copy-Item -Force (Join-Path $RepoDir 'deploy\windows\rollback.ps1') (Join-Path $AppDir 'rollback.ps1')
Copy-Item -Force (Join-Path $RepoDir 'deploy\windows\new-env.ps1')  (Join-Path $AppDir 'new-env.ps1')

# --------------------------------------------------------------- Настройки --

if (-not (Test-Path $EnvFile)) {
    throw @"
Нет файла настроек $EnvFile.
Создайте его одной командой на сервере:
    powershell -NoProfile -ExecutionPolicy Bypass -File $(Join-Path $AppDir 'new-env.ps1')
Скрипт уже доставлен и лежит по указанному пути.
"@
}

$apiPort = Read-EnvValue 'API_BIND_PORT'
if (-not $apiPort) { $apiPort = '18080' }

$publicAppUrl = Read-EnvValue 'PUBLIC_APP_URL'
if (-not $publicAppUrl) {
    throw "В $EnvFile не задан PUBLIC_APP_URL. Похоже, это файл локальной разработки: продуктовому стенду нужен образец deploy\env.prod.example."
}

# Секрет подписи входящих вызовов LMS и сайта.
#
# Файл настроек стенда мог быть создан до появления обмена либо по образцу,
# где у секрета стояла метка, которую new-env.ps1 не заменял. В обоих случаях
# секрета фактически нет — пустая строка либо текст из публичного репозитория,
# которым подписать событие может кто угодно. Такой секрет заменяется
# случайным прямо здесь: выкладка не должна зависеть от того, вспомнит ли
# кто-то поправить файл руками.
#
# Ключ маскирования ПДн в журнале аудита — по той же схеме. Он создаётся
# один раз и дальше не меняется: отпечатки, снятые разными ключами,
# между собой несравнимы.
#
# Для секрета подписи достаточно непустого значения: его могли согласовать
# с командой сайта, и замена молча разорвала бы обмен. Ключ маскирования
# короче 32 символов заменяется — его никто, кроме CRM, не знает.
function Initialize-EnvSecret([string] $Name, [string] $Purpose, [int] $MinLength = 1) {
    $current = Read-EnvValue $Name
    if ($current -and $current -notlike 'ЗАМЕНИТЬ*' -and $current.Length -ge $MinLength) { return }

    $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    $bytes = New-Object 'byte[]' 40
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $generated = -join ($bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] })

    $lines = [System.IO.File]::ReadAllLines($EnvFile, [System.Text.Encoding]::UTF8) |
        Where-Object { $_ -notmatch "^$Name=" }
    $lines += "$Name=$generated"
    [System.IO.File]::WriteAllLines($EnvFile, [string[]]$lines, (New-Object System.Text.UTF8Encoding($false)))

    Write-Note "$Purpose не был задан — сгенерирован и записан в .env"
}

Initialize-EnvSecret 'INTEGRATION_WEBHOOK_SECRET' 'секрет подписи входящих вызовов'
Initialize-EnvSecret 'AUDIT_MASK_KEY' 'ключ маскирования ПДн в журнале аудита' 32

$previousTag = $null
if (Test-Path $LastGood) { $previousTag = (Get-Content $LastGood -Raw).Trim() }

Write-Note "выпуск: $Sha"
Write-Note "прошлый удачный: $(if ($previousTag) { $previousTag } else { 'нет' })"
Write-Note "API ожидается на 127.0.0.1:$apiPort"

# ---------------------------------------------------------- Realm Keycloak ---
# Адреса возврата в экспорте realm указывают на localhost — на стенде они
# бесполезны. Подставляем домен стенда.
#
# Важно: импорт применяется ТОЛЬКО при первом запуске с пустой базой.
# На работающем стенде файл ни на что не влияет, и менять клиентов надо
# через консоль Keycloak.

Write-Step "Готовим realm Keycloak под домен $publicAppUrl"
$importDir = Join-Path $RepoDir 'deploy\keycloak-import'
New-Item -ItemType Directory -Force -Path $importDir | Out-Null

$realm = [System.IO.File]::ReadAllText((Join-Path $RepoDir 'keycloak\realm-export.json'), [System.Text.Encoding]::UTF8)
foreach ($origin in @('http://localhost:5173', 'http://localhost:4173', 'http://localhost:3001')) {
    $realm = $realm.Replace($origin, $publicAppUrl)
}
# Кодировка без BOM: Keycloak разбирает файл как JSON, и метка порядка байтов
# в начале ломает разбор ещё до первой фигурной скобки.
[System.IO.File]::WriteAllText((Join-Path $importDir 'realm-export.json'), $realm, (New-Object System.Text.UTF8Encoding($false)))

# ------------------------------------------------------------------ Бэкенд --

# Docker Desktop хранит учётные данные реестра в диспетчере учётных данных
# Windows, а тот привязан к интерактивному входу. Из сессии SSH помощник
# обращается к несуществующему сеансу, и сборка падает на скачивании базового
# образа: «A specified logon session does not exist».
#
# Все образы стенда публичные, учётные данные не нужны вовсе. Поэтому для
# развёртывания берётся отдельная конфигурация Docker без помощника — личная
# конфигурация пользователя остаётся нетронутой, а вместе с ней и вход
# в приватные реестры, если он там настроен.
Write-Step 'Готовим конфигурацию Docker без помощника учётных данных'

# Адрес движка выясняется ДО подмены конфигурации: сведения о контекстах
# лежат в личном каталоге пользователя, и в новом их не будет. Дальше адрес
# задаётся переменной DOCKER_HOST — она сильнее контекста и не требует
# копировать метаданные.
#
# Вывод ошибок наружу не перенаправляется: в Windows PowerShell 5.1 запись
# нативной команды в поток ошибок сама становится ошибкой при $ErrorActionPreference
# = 'Stop'. Обход тогда молча отключился бы, и сборка снова упала бы на
# учётных данных. Поэтому строгий режим на время вызова снимается, а успех
# определяется по коду возврата.
$dockerHost = $null
$previousPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try {
    $output = & docker context inspect --format '{{.Endpoints.docker.Host}}'
    if ($LASTEXITCODE -eq 0 -and $output) {
        $dockerHost = ($output | Select-Object -First 1).ToString().Trim()
    }
} catch {
    $dockerHost = $null
} finally {
    $ErrorActionPreference = $previousPreference
}

if ([string]::IsNullOrWhiteSpace($dockerHost)) {
    Write-Note 'адрес движка определить не удалось — оставляем конфигурацию Docker как есть'
} else {
    $dockerConfigDir = Join-Path $AppDir 'docker'
    New-Item -ItemType Directory -Force -Path $dockerConfigDir | Out-Null

    $userConfigPath = Join-Path $env:USERPROFILE '.docker\config.json'
    $config = [pscustomobject]@{}
    if (Test-Path $userConfigPath) {
        try {
            $parsed = Get-Content $userConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
            if ($parsed) { $config = $parsed }
        } catch {
            Write-Note 'личная конфигурация Docker нечитаема, берём пустую'
        }
    }

    # currentContext убирается вместе с помощником: контекста с таким именем
    # в новом каталоге нет, и docker отказался бы подключаться вовсе.
    foreach ($key in @('credsStore', 'credStore', 'credHelpers', 'auths', 'currentContext')) {
        if ($config.PSObject.Properties.Name -contains $key) { $config.PSObject.Properties.Remove($key) }
    }

    [System.IO.File]::WriteAllText(
        (Join-Path $dockerConfigDir 'config.json'),
        ($config | ConvertTo-Json -Depth 10),
        (New-Object System.Text.UTF8Encoding($false))
    )

    $env:DOCKER_CONFIG = $dockerConfigDir
    $env:DOCKER_HOST = $dockerHost
    Write-Note "движок: $dockerHost"
    Write-Note "конфигурация: $(((Get-Content (Join-Path $dockerConfigDir 'config.json') -Raw) -replace '\s+', ' ').Trim())"
}

# Проверка на кошке: то же обращение к реестру, что делает сборка, но дешёвое
# и с понятным сообщением. Если помощник учётных данных всё ещё вмешивается,
# это видно здесь, а не в середине многоминутной сборки.
$baseImage = 'node:24-alpine'
$dockerfilePath = Join-Path $RepoDir 'Dockerfile'
if (Test-Path $dockerfilePath) {
    $versionLine = Select-String -Path $dockerfilePath -Pattern '^ARG NODE_VERSION=(.+)$' | Select-Object -First 1
    if ($versionLine) { $baseImage = 'node:' + $versionLine.Matches[0].Groups[1].Value.Trim() }
}

Write-Step "Проверяем доступ к реестру образов: $baseImage"

if (-not (Test-RegistryAccess $baseImage)) {
    Write-Note 'отдельная конфигурация не помогла — помощник берётся из личной'

    # Помощник на сервере без интерактивного входа нерабочий в принципе:
    # он обращается к диспетчеру учётных данных, привязанному к сеансу.
    # Убираем его из личной конфигурации, сохранив копию. Образы стенда
    # публичные, поэтому учётные данные не теряются вместе с ним.
    $userConfigPath = Join-Path $env:USERPROFILE '.docker\config.json'
    if (-not (Test-Path $userConfigPath)) {
        throw "Реестр образов недоступен, и личной конфигурации Docker нет ($userConfigPath). Проверьте подключение сервера к сети."
    }

    $backupPath = "$userConfigPath.before-deploy"
    if (-not (Test-Path $backupPath)) { Copy-Item $userConfigPath $backupPath }

    $userConfig = Get-Content $userConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($key in @('credsStore', 'credStore', 'credHelpers')) {
        if ($userConfig.PSObject.Properties.Name -contains $key) { $userConfig.PSObject.Properties.Remove($key) }
    }
    [System.IO.File]::WriteAllText($userConfigPath, ($userConfig | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))

    Write-Note "помощник убран из $userConfigPath"
    Write-Note "копия прежней конфигурации: $backupPath"

    # Возвращаемся к личной конфигурации: в ней есть контексты и, если были,
    # сохранённые входы в приватные реестры.
    Remove-Item Env:\DOCKER_CONFIG -ErrorAction SilentlyContinue
    Remove-Item Env:\DOCKER_HOST -ErrorAction SilentlyContinue

    if (-not (Test-RegistryAccess $baseImage)) {
        throw "Реестр образов недоступен даже без помощника учётных данных. Проверьте сеть и состояние Docker Desktop; прежняя конфигурация сохранена в $backupPath."
    }
}

Write-Note 'реестр доступен'

$env:IMAGE_TAG = $Sha

Write-Step "Собираем образы: тег $Sha"
Invoke-Compose build api migrate

Write-Step 'Поднимаем стек (миграции выполняются отдельной задачей до старта API)'
Invoke-Compose up -d --remove-orphans

# Демонстрационное наполнение. Реальных данных заказчик не предоставляет,
# поэтому стенд должен показывать работу на подготовленном наборе: каталоги,
# вузы, взаимодействия, пользователи. Базовые процессы приходят миграцией
# и от этого шага не зависят.
#
# Наполнение идемпотентно: существующие записи не трогаются, действующая
# редакция процесса не подменяется. Поэтому шаг безопасно повторяется
# при каждой выкладке и восстанавливает данные, если том базы пересоздали.
$seedDemo = Read-EnvValue 'SEED_DEMO_DATA'

if ($seedDemo -eq 'true') {
    Write-Step 'Наполняем базу демонстрационными данными'
    Invoke-Compose run --rm migrate npx prisma db seed
} else {
    Write-Note 'демонстрационное наполнение выключено (SEED_DEMO_DATA)'
}

Write-Step "Ждём готовности API на 127.0.0.1:$apiPort"

# Две пробы, а не одна. /health/live отвечает, пока жив процесс; /health/ready
# добавляет к этому состояние Postgres и Redis. Различать их важно: без Redis
# система работает в урезанном виде, и валить из-за этого выкладку, откатывая
# исправный образ, — решение хуже самой неполадки.
$readyProbe = $null
$liveProbe = $null

for ($attempt = 1; $attempt -le 60; $attempt++) {
    $readyProbe = Get-Probe ([int] $apiPort) '/health/ready'
    if ($readyProbe.Code -eq 200) {
        Write-Note "API готов (попытка $attempt)"
        break
    }

    $liveProbe = Get-Probe ([int] $apiPort) '/health/live'
    Start-Sleep -Seconds 5
}

if ($readyProbe.Code -ne 200) {
    if ($liveProbe -and $liveProbe.Code -eq 200) {
        # Процесс поднялся и отвечает — выкладку продолжаем, но говорим прямо,
        # чего именно не хватает: тело пробы называет отказавшую зависимость.
        Write-Host "`nAPI отвечает, но готовность не подтверждена." -ForegroundColor Yellow
        Write-Note "ответ /health/ready (код $($readyProbe.Code)): $($readyProbe.Body)"
    } else {
        Write-Host "`n--- Состояние контейнеров ---" -ForegroundColor Yellow
        Show-ComposeState

        Write-Host "`n--- Журнал API без служебных проб ---" -ForegroundColor Yellow
        Show-ApiLog

        if ($previousTag) {
            Write-Step "Откатываемся на прошлый выпуск $previousTag"
            $env:IMAGE_TAG = $previousTag
            try { Invoke-Compose up -d } catch { Write-Note "откат не удался: $_" }
        }

        throw "API не ответил на 127.0.0.1:$apiPort за 5 минут. Статика не переключена."
    }
}

# ------------------------------------------------------------------ Статика --
# Каталог выпуска распаковывается целиком, и только потом переставляется
# точка соединения: Caddy не видит полураспакованного каталога.

Write-Step "Раскладываем статику выпуска $Sha"
$releaseDir = Join-Path $ReleasesDir $Sha
if (Test-Path $releaseDir) { Remove-Item -Recurse -Force $releaseDir }
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
& tar -xzf $webArchive -C $releaseDir
if ($LASTEXITCODE -ne 0) { throw 'Не удалось распаковать архив статики.' }

Set-CurrentRelease $releaseDir
Write-Note "current → $releaseDir"

# ------------------------------------------------------------------ Уборка --

Set-Content -Path $LastGood -Value $Sha -Encoding ASCII
Remove-Item -Force $sourceArchive, $webArchive -ErrorAction SilentlyContinue

Write-Step "Убираем старые выпуски (оставляем $KeepReleases)"
Get-ChildItem -Path $ReleasesDir -Directory |
    Sort-Object CreationTime -Descending |
    Select-Object -Skip $KeepReleases |
    ForEach-Object {
        Write-Note "удаляем $($_.Name)"
        Remove-Item -Recurse -Force $_.FullName
    }

# Удаляются только висячие слои: образы прошлых выпусков остаются
# и нужны для отката одной командой.
& docker image prune -f | Out-Null

Write-Step "Готово. Выпуск $Sha развёрнут."
Invoke-Compose ps

// ========================================
// Вход через Keycloak: Authorization Code + PKCE
//
// Пароль в интерфейсе не вводится: подлинность подтверждает Keycloak,
// приложение получает токены обменом кода. Публичный клиент crm-frontend
// и адреса возврата описаны в keycloak/realm-export.json; на стенде
// deploy.ps1 подставляет в них домен стенда.
// ========================================
import { keycloak, type KeycloakConfig } from "@/shared/config"

const TOKENS = {
  access: "crm_access_token",
  refresh: "crm_refresh_token",
  expiresAt: "crm_token_expires_at",
  id: "crm_id_token",
} as const

// Параметры незавершённого входа живут в sessionStorage: они нужны только
// вкладке, которая ушла на Keycloak, и не должны пережить её закрытие.
const PENDING = {
  verifier: "crm_pkce_verifier",
  state: "crm_pkce_state",
  returnTo: "crm_login_return_to",
} as const

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
}

type RefreshResult = "ok" | "expired" | "unavailable"

function requireConfig(): KeycloakConfig {
  if (!keycloak) throw new Error("Keycloak не настроен: не задан VITE_KEYCLOAK_URL")
  return keycloak
}

function endpoint(name: "auth" | "token" | "logout"): string {
  const kc = requireConfig()
  return `${kc.url}/realms/${encodeURIComponent(kc.realm)}/protocol/openid-connect/${name}`
}

/** Совпадает с redirectUris клиента crm-frontend (`<origin>/*`). */
const redirectUri = () => `${window.location.origin}/`

// ---------------------------------------- токены

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKENS.access)
}

export function hasSession(): boolean {
  return Boolean(localStorage.getItem(TOKENS.refresh) || localStorage.getItem(TOKENS.access))
}

export function clearSession(): void {
  for (const key of Object.values(TOKENS)) localStorage.removeItem(key)
  if (refreshTimer) window.clearTimeout(refreshTimer)
  refreshTimer = undefined
}

function storeTokens(tokens: TokenResponse): void {
  const lifetime = tokens.expires_in ?? 300
  localStorage.setItem(TOKENS.access, tokens.access_token)
  localStorage.setItem(TOKENS.expiresAt, String(Date.now() + lifetime * 1000))
  if (tokens.refresh_token) localStorage.setItem(TOKENS.refresh, tokens.refresh_token)
  if (tokens.id_token) localStorage.setItem(TOKENS.id, tokens.id_token)
  scheduleRefresh(lifetime)
}

async function requestTokens(body: URLSearchParams): Promise<Response> {
  return fetch(endpoint("token"), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  })
}

// ---------------------------------------- вход

/** Уводит браузер на страницу входа Keycloak. */
export async function beginLogin(returnTo = "/"): Promise<void> {
  const kc = requireConfig()
  const verifier = randomString(64)
  const state = randomString(24)
  const challenge = await pkceChallenge(verifier)

  sessionStorage.setItem(PENDING.verifier, verifier)
  sessionStorage.setItem(PENDING.state, state)
  sessionStorage.setItem(PENDING.returnTo, safeReturnPath(returnTo))

  const params = new URLSearchParams({
    client_id: kc.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "openid profile email",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state,
  })
  window.location.assign(`${endpoint("auth")}?${params.toString()}`)
}

/**
 * Завершает вход, если браузер вернулся с Keycloak с кодом или ошибкой.
 *
 * До первого await функция выполняется синхронно: адрес возврата
 * восстанавливается в истории ДО того, как роутер прочитает location,
 * поэтому пользователь оказывается на той странице, с которой ушёл на вход.
 *
 * Возвращает null, если это не возврат с Keycloak; иначе — результат входа.
 */
export async function handleRedirectCallback(): Promise<{ error: string | null } | null> {
  const url = new URL(window.location.href)
  const code = url.searchParams.get("code")
  const error = url.searchParams.get("error")
  const state = url.searchParams.get("state")
  if (url.pathname !== "/" || !state || (!code && !error)) return null

  const expectedState = sessionStorage.getItem(PENDING.state)
  const verifier = sessionStorage.getItem(PENDING.verifier)
  const returnTo = sessionStorage.getItem(PENDING.returnTo) ?? "/"
  for (const key of Object.values(PENDING)) sessionStorage.removeItem(key)
  // Код одноразовый: убираем его из адреса, чтобы он не попал в историю и закладки.
  window.history.replaceState(null, "", safeReturnPath(returnTo))

  if (error) {
    const description = url.searchParams.get("error_description")
    return { error: description ? `Вход отклонён: ${description}` : `Вход отклонён (${error})` }
  }
  if (!expectedState || state !== expectedState) {
    return { error: "Не совпал параметр state — вход отклонён. Повторите попытку." }
  }
  if (!verifier) return { error: "Потерян проверочный код PKCE. Повторите вход." }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: requireConfig().clientId,
    code: code as string,
    redirect_uri: redirectUri(),
    code_verifier: verifier,
  })

  try {
    const response = await requestTokens(body)
    if (!response.ok) {
      return { error: `Keycloak отклонил обмен кода на токен (HTTP ${response.status}).` }
    }
    storeTokens((await response.json()) as TokenResponse)
    return { error: null }
  } catch {
    return { error: `Keycloak недоступен по адресу ${requireConfig().url}.` }
  }
}

/** Выход: локальная сессия сбрасывается, затем выход на стороне Keycloak. */
export function logoutRedirect(): void {
  const kc = requireConfig()
  const idToken = localStorage.getItem(TOKENS.id)
  clearSession()

  const params = new URLSearchParams({
    client_id: kc.clientId,
    post_logout_redirect_uri: redirectUri(),
  })
  // С id_token_hint Keycloak завершает сеанс без экрана подтверждения.
  if (idToken) params.set("id_token_hint", idToken)
  window.location.assign(`${endpoint("logout")}?${params.toString()}`)
}

// ---------------------------------------- обновление токена

let refreshTimer: number | undefined
let inflight: Promise<RefreshResult> | null = null
let onExpired: (() => void) | null = null

/**
 * Обновление заранее, а не по факту отказа: срок жизни access-токена
 * в realm — 15 минут, и без этого первый запрос после паузы падал бы с 401.
 */
function scheduleRefresh(lifetimeSec: number): void {
  if (refreshTimer) window.clearTimeout(refreshTimer)
  const delay = Math.max(20, lifetimeSec * 0.6) * 1000
  refreshTimer = window.setTimeout(() => void refreshOnTimer(), delay)
}

/**
 * Вкладки делят localStorage, но таймеры у каждой свои. Keycloak при
 * обновлении гасит прежний refresh-токен, поэтому две вкладки, обновляющиеся
 * независимо, выбивали бы друг друга (invalid_grant). Перед обновлением
 * сверяемся с общим сроком: если соседняя вкладка уже обновила — переносим таймер.
 */
async function refreshOnTimer(): Promise<void> {
  const left = (Number(localStorage.getItem(TOKENS.expiresAt) ?? 0) - Date.now()) / 1000
  if (left > 60) {
    scheduleRefresh(left)
    return
  }
  const result = await refreshTokens()
  if (result === "unavailable") refreshTimer = window.setTimeout(() => void refreshOnTimer(), 30_000)
  if (result === "expired") expire()
}

export function refreshTokens(): Promise<RefreshResult> {
  // Параллельные 401 от нескольких запросов — одно обновление на всех.
  inflight ??= doRefresh().finally(() => {
    inflight = null
  })
  return inflight
}

async function doRefresh(): Promise<RefreshResult> {
  const token = localStorage.getItem(TOKENS.refresh)
  if (!token) return "expired"

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: requireConfig().clientId,
    refresh_token: token,
  })
  try {
    const response = await requestTokens(body)
    if (!response.ok) return response.status >= 500 ? "unavailable" : "expired"
    storeTokens((await response.json()) as TokenResponse)
    return "ok"
  } catch {
    return "unavailable"
  }
}

/**
 * Попытка вернуть рабочий токен после 401. `usedToken` — токен, с которым
 * ушёл отвергнутый запрос: если соседняя вкладка уже обновила токен,
 * достаточно повторить запрос с новым.
 */
export async function recoverFromUnauthorized(usedToken: string | null): Promise<boolean> {
  const current = getAccessToken()
  if (current && current !== usedToken) return true
  return (await refreshTokens()) === "ok"
}

function expire(): void {
  clearSession()
  onExpired?.()
}

/**
 * Восстанавливает таймер обновления после перезагрузки страницы.
 * `expiredHandler` вызывается, когда сессию продлить невозможно.
 */
export function startSessionKeeper(expiredHandler: () => void): void {
  onExpired = expiredHandler
  const left = (Number(localStorage.getItem(TOKENS.expiresAt) ?? 0) - Date.now()) / 1000
  scheduleRefresh(Math.max(0, left))
}

if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    // Соседняя вкладка обновила токен — переносим свой таймер,
    // чтобы не погасить только что выданный refresh-токен.
    if (event.key === TOKENS.expiresAt && event.newValue) {
      scheduleRefresh(Math.max(0, (Number(event.newValue) - Date.now()) / 1000))
    }
    // Соседняя вкладка вышла из системы — выходим и здесь.
    if (event.key === TOKENS.refresh && event.newValue === null && onExpired) expire()
  })
}

// ---------------------------------------- PKCE и утилиты

function randomString(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, length)
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  let binary = ""
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

/** Только относительный путь этого же приложения — никаких открытых редиректов. */
function safeReturnPath(path: string): string {
  const isLogin = path.split(/[?#]/)[0] === "/login"
  return path.startsWith("/") && !path.startsWith("//") && !isLogin ? path : "/"
}

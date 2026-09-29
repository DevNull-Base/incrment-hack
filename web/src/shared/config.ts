// ========================================
// Конфигурация сборки (переменные VITE_*)
// Значения подставляются при сборке: на стенде их задаёт CI,
// локально — web/.env (образец — web/.env.example).
// ========================================

export interface KeycloakConfig {
  url: string
  realm: string
  clientId: string
}

export type AuthMode = "keycloak" | "mock"
export type DataSource = "api" | "mock"

const env = import.meta.env

const keycloakUrl = env.VITE_KEYCLOAK_URL?.trim().replace(/\/$/, "")

/**
 * Keycloak включается адресом провайдера. Без него работает демо-вход
 * по тестовым аккаунтам — так фронтенд разрабатывается без бэкенда.
 */
export const keycloak: KeycloakConfig | null = keycloakUrl
  ? {
      url: keycloakUrl,
      realm: env.VITE_KEYCLOAK_REALM?.trim() || "rtk-crm",
      clientId: env.VITE_KEYCLOAK_CLIENT_ID?.trim() || "crm-frontend",
    }
  : null

export const authMode: AuthMode = keycloak ? "keycloak" : "mock"

/**
 * Источник данных стора: api — всё с бэкенда (app/store/api-data.ts),
 * mock — демо на моках без обращения к API. Без переменной — mock:
 * фронтенд разрабатывается и без поднятого бэкенда.
 */
export const dataSource: DataSource = env.VITE_DATA_SOURCE === "api" ? "api" : "mock"

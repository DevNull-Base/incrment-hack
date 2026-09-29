/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Адрес Keycloak, например https://auth.incrment.ru. Не задан — демо-вход. */
  readonly VITE_KEYCLOAK_URL?: string
  readonly VITE_KEYCLOAK_REALM?: string
  readonly VITE_KEYCLOAK_CLIENT_ID?: string
  /** mock (по умолчанию) | api — источник данных стора. */
  readonly VITE_DATA_SOURCE?: string
  /** Только для dev-сервера: адрес бэкенда для прокси /api и /socket.io. */
  readonly VITE_API_TARGET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

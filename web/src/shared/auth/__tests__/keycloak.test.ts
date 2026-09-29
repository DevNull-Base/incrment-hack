import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type KeycloakModule = typeof import("../keycloak")

const tokenResponse = (access: string) =>
  new Response(
    JSON.stringify({ access_token: access, refresh_token: `r-${access}`, id_token: "id", expires_in: 900 }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  )

async function loadModule(): Promise<KeycloakModule> {
  vi.resetModules()
  vi.stubEnv("VITE_KEYCLOAK_URL", "https://auth.example.test/")
  return import("../keycloak")
}

describe("keycloak", () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    window.history.replaceState(null, "", "/")
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  describe("handleRedirectCallback", () => {
    it("не трогает обычную загрузку страницы", async () => {
      const kc = await loadModule()
      window.history.replaceState(null, "", "/interactions?code=x")

      expect(await kc.handleRedirectCallback()).toBeNull()
      expect(window.location.search).toBe("?code=x")
    })

    it("меняет код на токены и возвращает на исходную страницу", async () => {
      const kc = await loadModule()
      sessionStorage.setItem("crm_pkce_state", "st")
      sessionStorage.setItem("crm_pkce_verifier", "ver")
      sessionStorage.setItem("crm_login_return_to", "/interactions/42?l=a")
      window.history.replaceState(null, "", "/?code=abc&state=st&session_state=s")
      fetchMock.mockResolvedValueOnce(tokenResponse("a1"))

      const pending = kc.handleRedirectCallback()
      // Адрес восстанавливается синхронно — до того, как роутер его прочитает.
      expect(window.location.pathname + window.location.search).toBe("/interactions/42?l=a")

      expect(await pending).toEqual({ error: null })
      expect(kc.getAccessToken()).toBe("a1")
      expect(kc.hasSession()).toBe(true)

      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe("https://auth.example.test/realms/rtk-crm/protocol/openid-connect/token")
      const body = new URLSearchParams(init.body)
      expect(body.get("code")).toBe("abc")
      expect(body.get("code_verifier")).toBe("ver")
      expect(body.get("client_id")).toBe("crm-frontend")
      expect(body.get("redirect_uri")).toBe(`${window.location.origin}/`)
      expect(sessionStorage.getItem("crm_pkce_verifier")).toBeNull()
    })

    it("отклоняет чужой state", async () => {
      const kc = await loadModule()
      sessionStorage.setItem("crm_pkce_state", "expected")
      sessionStorage.setItem("crm_pkce_verifier", "ver")
      window.history.replaceState(null, "", "/?code=abc&state=forged")

      const result = await kc.handleRedirectCallback()

      expect(result?.error).toMatch(/state/)
      expect(fetchMock).not.toHaveBeenCalled()
      expect(window.location.search).toBe("")
    })

    it("не уводит на внешний адрес после входа", async () => {
      const kc = await loadModule()
      sessionStorage.setItem("crm_pkce_state", "st")
      sessionStorage.setItem("crm_login_return_to", "//evil.example")
      window.history.replaceState(null, "", "/?error=access_denied&state=st")

      const result = await kc.handleRedirectCallback()

      expect(result?.error).toMatch(/access_denied/)
      expect(window.location.pathname).toBe("/")
    })
  })

  describe("recoverFromUnauthorized", () => {
    it("повторяет запрос без обновления, если токен уже обновила соседняя вкладка", async () => {
      const kc = await loadModule()
      localStorage.setItem("crm_access_token", "fresh")

      expect(await kc.recoverFromUnauthorized("stale")).toBe(true)
      expect(fetchMock).not.toHaveBeenCalled()
    })

    it("обновляет токен один раз на все параллельные 401", async () => {
      const kc = await loadModule()
      localStorage.setItem("crm_access_token", "old")
      localStorage.setItem("crm_refresh_token", "r-old")
      fetchMock.mockResolvedValueOnce(tokenResponse("new"))

      const results = await Promise.all([
        kc.recoverFromUnauthorized("old"),
        kc.recoverFromUnauthorized("old"),
      ])

      expect(results).toEqual([true, true])
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(kc.getAccessToken()).toBe("new")
    })

    it("сообщает об истёкшей сессии, если Keycloak отверг refresh-токен", async () => {
      const kc = await loadModule()
      localStorage.setItem("crm_access_token", "old")
      localStorage.setItem("crm_refresh_token", "r-old")
      fetchMock.mockResolvedValueOnce(new Response('{"error":"invalid_grant"}', { status: 400 }))

      expect(await kc.recoverFromUnauthorized("old")).toBe(false)
    })
  })
})

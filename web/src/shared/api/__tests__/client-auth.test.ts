import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError, api, configureApi } from "../client"

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })

const me = { id: "u1", email: "a@b.c", displayName: "A", role: "USER", managerId: null, dataScope: {} }

describe("client: 401", () => {
  let token: string
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    token = "old"
    fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    configureApi({ onUnauthorized: undefined, onSessionExpired: undefined })
  })

  it("обновляет токен и повторяет запрос", async () => {
    const onUnauthorized = vi.fn(async () => {
      token = "new"
      return true
    })
    configureApi({ getToken: () => token, onUnauthorized })
    fetchMock.mockResolvedValueOnce(json(401, {})).mockResolvedValueOnce(json(200, me))

    await expect(api.auth.me()).resolves.toEqual(me)

    expect(onUnauthorized).toHaveBeenCalledWith("old")
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe("Bearer new")
  })

  it("не зацикливается: второй 401 — истёкшая сессия", async () => {
    const onSessionExpired = vi.fn()
    configureApi({ getToken: () => token, onUnauthorized: async () => true, onSessionExpired })
    fetchMock.mockResolvedValue(json(401, {}))

    await expect(api.auth.me()).rejects.toBeInstanceOf(ApiError)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(onSessionExpired).toHaveBeenCalledTimes(1)
  })
})

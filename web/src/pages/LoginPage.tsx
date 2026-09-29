import { useState } from "react"
import { Navigate, useLocation, useNavigate } from "react-router-dom"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useStore, TEST_ACCOUNTS } from "@/app/store"
import { ROLE_LABELS } from "@/shared/lib/roles"
import { toast } from "@/shared/lib/toast-store"
import { authMode } from "@/shared/config"

export function LoginPage() {
  const location = useLocation()
  const status = useStore((s) => s.sessionStatus)
  const from = (location.state as { from?: { pathname: string; search?: string; hash?: string } } | null)?.from
  const returnTo = from ? `${from.pathname}${from.search ?? ""}${from.hash ?? ""}` : "/"

  if (status === "authenticated") return <Navigate to={returnTo} replace />

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-[380px]">
        {/* Бренд */}
        <div className="flex flex-col gap-3">
          <div className="h-[2px] w-12 bg-gradient-to-r from-[#7700FF] to-transparent" />
          <span className="text-2xl font-semibold tracking-tight">
            incrment<span className="text-primary">.</span>
          </span>
        </div>

        <h1 className="mt-10 text-xl font-semibold">Вход в систему</h1>
        {authMode === "keycloak" ? <KeycloakLogin returnTo={returnTo} /> : <DemoLogin />}
      </div>
    </div>
  )
}

/**
 * Вход через Keycloak: пароль вводится на странице провайдера,
 * после входа браузер возвращается на страницу, с которой ушёл.
 */
function KeycloakLogin({ returnTo }: { returnTo: string }) {
  const loginWithKeycloak = useStore((s) => s.loginWithKeycloak)
  const sessionError = useStore((s) => s.sessionError)
  const [redirecting, setRedirecting] = useState(false)

  const handleLogin = () => {
    setRedirecting(true)
    loginWithKeycloak(returnTo).catch(() => {
      // PKCE требует Web Crypto, а браузер даёт его только по HTTPS и на localhost.
      setRedirecting(false)
      toast.error("Не удалось начать вход", "Нужно защищённое соединение (HTTPS или localhost)")
    })
  }

  return (
    <>
      <p className="mt-1 text-sm text-muted-foreground">
        Вход по корпоративной учётной записи
      </p>

      <div className="mt-8 space-y-4">
        {sessionError && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {sessionError}
          </div>
        )}

        <Button
          type="button"
          onClick={handleLogin}
          disabled={redirecting}
          className="h-11 w-full rounded-lg font-medium"
        >
          {redirecting ? "Перенаправление…" : "Войти"}
        </Button>
      </div>
    </>
  )
}

/** Демо-вход по TEST_ACCOUNTS — режим разработки без бэкенда (VITE_KEYCLOAK_URL не задан). */
function DemoLogin() {
  const [email, setEmail] = useState("ivanov@rtk.ru")
  const [password, setPassword] = useState("manager123")
  const [error, setError] = useState("")
  const navigate = useNavigate()
  const login = useStore((s) => s.login)

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault()
    if (login(email, password)) {
      toast.success("Вход выполнен")
      navigate("/")
    } else {
      setError("Неверный email или пароль")
      toast.error("Не удалось войти", "Неверный email или пароль")
    }
  }

  return (
    <>
      <p className="mt-1 text-sm text-muted-foreground">Введите учётные данные</p>

      <form onSubmit={handleLogin} className="mt-8 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-sm font-medium">
            Email
          </Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="your@rtk.ru"
            className="h-11 rounded-lg"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password" className="text-sm font-medium">
            Пароль
          </Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-11 rounded-lg"
          />
        </div>

        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            {error}
          </div>
        )}

        <Button type="submit" className="h-11 w-full rounded-lg font-medium">
          Войти
        </Button>
      </form>

      {/* Демо-режим: в сборке с Keycloak этот блок не показывается */}
      <div className="mt-8 border-t border-border/60 pt-5">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Тестовые учётные записи
        </p>
        <div className="space-y-0.5">
          {TEST_ACCOUNTS.map((acc) => (
            <Button
              variant="ghost"
              key={acc.email}
              onClick={() => {
                setEmail(acc.email)
                setPassword(acc.password)
                setError("")
              }}
              className="group flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-xs transition-colors duration-300 ease-[cubic-bezier(0.645,0.045,0.355,1)] hover:bg-muted/60"
            >
              <span className="text-muted-foreground transition-colors group-hover:text-foreground">
                {acc.email}
              </span>
              <span className="font-medium text-primary">{ROLE_LABELS[acc.user.role]}</span>
            </Button>
          ))}
        </div>
      </div>
    </>
  )
}

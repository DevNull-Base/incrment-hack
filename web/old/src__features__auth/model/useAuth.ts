import { useNavigate } from "react-router-dom"

interface User {
  email: string
  password: string
  role: string
  name: string
}

const TEST_ACCOUNTS: User[] = [
  { email: "ivanov@rtk.ru", password: "manager123", role: "Менеджер", name: "Иванов А.П." },
  { email: "sidorov@rtk.ru", password: "lead123", role: "Руководитель", name: "Сидоров Д.О." },
  { email: "admin@rtk.ru", password: "admin123", role: "Администратор", name: "Админ Системы" },
  { email: "kozlova@rtk.ru", password: "methodist123", role: "Методист", name: "Козлова Е.В." },
]

export function useAuth() {
  const navigate = useNavigate()

  const getUser = (): User | null => {
    const raw = localStorage.getItem("crm_user")
    return raw ? JSON.parse(raw) : null
  }

  const login = (email: string, password: string): boolean => {
    const account = TEST_ACCOUNTS.find((a) => a.email === email && a.password === password)
    if (account) {
      localStorage.setItem("crm_user", JSON.stringify(account))
      navigate("/")
      return true
    }
    return false
  }

  const logout = () => {
    localStorage.removeItem("crm_user")
    navigate("/login")
  }

  const isAuthenticated = (): boolean => {
    return localStorage.getItem("crm_user") !== null
  }

  return { getUser, login, logout, isAuthenticated, TEST_ACCOUNTS }
}

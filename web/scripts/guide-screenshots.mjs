// ========================================
// Снимки экранов для встроенных руководств (docs/guides/images).
//
// ТЗ требует, чтобы документация содержала скриншоты элементов интерфейса.
// Снимки делаются этим скриптом, а не руками: после изменения интерфейса
// их пересобирают одной командой, и справка не расходится с системой.
//
// Нужны: запущенный фронтенд (npm run dev) с бэкендом и Keycloak, база,
// наполненная сидом (npm run db:seed в корне), — на снимках только
// демонстрационные данные. Браузер — установленный Edge или Chrome
// (GUIDE_BROWSER=chrome), скачивать Chromium для Playwright не нужно.
//
//   node scripts/guide-screenshots.mjs
//
// Переменные: GUIDE_BASE_URL (по умолчанию http://localhost:5173),
// GUIDE_MANAGER_LOGIN/PASSWORD и GUIDE_ADMIN_LOGIN/PASSWORD — учётные
// записи демонстрационного realm (keycloak/README.md).
// ========================================
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "playwright"

const here = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.resolve(here, "../../docs/guides/images")
const BASE = (process.env.GUIDE_BASE_URL ?? "http://localhost:5173").replace(/\/$/, "")
const CHANNEL = process.env.GUIDE_BROWSER === "chrome" ? "chrome" : "msedge"
const VIEWPORT = { width: 1440, height: 900 }

const ACCOUNTS = {
  manager: {
    login: process.env.GUIDE_MANAGER_LOGIN ?? "manager.petrov",
    password: process.env.GUIDE_MANAGER_PASSWORD ?? "Mgr#2026demo",
  },
  admin: {
    login: process.env.GUIDE_ADMIN_LOGIN ?? "admin.sidorov",
    password: process.env.GUIDE_ADMIN_PASSWORD ?? "Adm#2026demo",
  },
}

const shots = []

async function save(target, name, options = {}) {
  const file = path.join(OUT_DIR, `${name}.png`)
  await target.screenshot({ path: file, animations: "disabled", ...options })
  shots.push(name)
  console.log(`  ${name}.png`)
}

/**
 * Дождаться, пока интерфейс загрузит данные и перестанет двигаться.
 * Плавающая кнопка чата на снимках не нужна: она перекрывает содержимое
 * в углу, а чат в справке не описывается.
 */
async function settle(page) {
  await page.waitForLoadState("networkidle").catch(() => {})
  await page.addStyleTag({ content: "[data-chat-launcher]{display:none!important}" }).catch(() => {})
  await page.waitForTimeout(600)
}

async function open(page, route) {
  await page.goto(`${BASE}${route}`)
  await settle(page)
}

/** Запрос к API от имени вошедшего пользователя — чтобы выбрать наглядные примеры. */
async function apiGet(page, route) {
  return page.evaluate(async (url) => {
    const token = localStorage.getItem("crm_access_token")
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    return response.json()
  }, `/api/v1${route}`)
}

/** Прокрутить область содержимого (у страницы своя полоса прокрутки). */
async function scrollContentTo(page, locator) {
  await locator.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
}

async function login(context, account) {
  const page = await context.newPage()
  await page.goto(`${BASE}/login`)
  await page.getByRole("button", { name: "Войти" }).click()
  await page.waitForURL(/\/realms\//)
  await page.locator("#username").fill(account.login)
  await page.locator("#password").fill(account.password)
  await page.locator("#kc-login, button[type=submit]").first().click()
  await page.waitForURL((url) => url.href.startsWith(BASE) && !url.pathname.startsWith("/login"))
  await settle(page)
  return page
}

async function newContext(browser) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: "light", locale: "ru-RU" })
  // Светлая тема: снимки печатаются и читаются в любом оформлении справки.
  await context.addInitScript(() => localStorage.setItem("crm_theme", "light"))
  return context
}

async function managerShots(browser) {
  const context = await newContext(browser)

  // Экран входа почти пуст — снимается область вокруг формы.
  const loginPage = await context.newPage()
  await open(loginPage, "/login")
  const heading = await loginPage.getByText("Вход в систему").boundingBox()
  const button = await loginPage.getByRole("button", { name: "Войти" }).boundingBox()
  if (heading && button) {
    const x = Math.min(heading.x, button.x) - 60
    const y = heading.y - 90
    await save(loginPage, "login", {
      clip: { x, y, width: Math.max(heading.width, button.width) + 120, height: button.y + button.height + 60 - y },
    })
  } else {
    await save(loginPage, "login")
  }
  await loginPage.close()

  const page = await login(context, ACCOUNTS.manager)

  await open(page, "/")
  await save(page, "dashboard")

  // Поиск в шапке: результаты по группам.
  const search = page.getByRole("combobox", { name: /Поиск по вузам/ })
  await search.click()
  await search.fill("каз")
  await page.waitForTimeout(400)
  await save(page, "search", { clip: { x: 360, y: 0, width: 720, height: 560 } })
  await page.keyboard.press("Escape")

  await open(page, "/interactions")
  const reset = page.getByRole("button", { name: /Сбросить/ })
  if (await reset.isEnabled()) await reset.click()
  await page.getByLabel("Ответственный").selectOption({ label: "Иванова Анна" })
  await page.waitForTimeout(400)
  await save(page, "interactions-filters")
  await page.getByRole("button", { name: /Сбросить/ }).click()

  // Карточка взаимодействия: заявка, прошедшая встречу, — у неё есть
  // и встреча с итогами, и заметки, и история.
  const sample = await apiGet(page, "/engagements?segment=B2B&stateKey=DOCUMENTS_EXCHANGE&limit=20")
  const withNotes = []
  for (const item of sample.items ?? []) {
    const notes = await apiGet(page, `/engagements/${item.id}/notes`)
    withNotes.push({ id: item.id, notes: Array.isArray(notes) ? notes.length : 0 })
  }
  withNotes.sort((a, b) => b.notes - a.notes)
  await open(page, `/interactions/${withNotes[0]?.id ?? ""}`)
  await save(page, "interaction-card")
  const meetingsCard = page.locator("[data-slot='card']", { has: page.getByText(/^Встречи \(\d+\)$/) })
  await scrollContentTo(page, meetingsCard)
  await save(meetingsCard, "meetings")
  await page.getByRole("button", { name: "Назначить встречу" }).click()
  await page.waitForTimeout(400)
  await save(page.getByRole("dialog"), "meeting-dialog")
  await page.keyboard.press("Escape")

  // Страница вуза: договоры, потоки, заметки по вузу.
  await search.click()
  await search.fill("ИТМО")
  await page.waitForTimeout(300)
  await page.keyboard.press("Enter")
  await settle(page)
  await scrollContentTo(page, page.getByRole("heading", { level: 1 }))
  await save(page, "university-card")
  await scrollContentTo(page, page.getByText(/^Потоки \(\d+\)$/))
  await save(page, "university-streams")

  await open(page, "/programs")
  await save(page, "programs-ranking")

  await open(page, "/courses")
  await save(page, "courses")

  await open(page, "/analytics")
  const report = page.locator("main").getByText("Отчёт по взаимодействиям").locator("xpath=ancestor::*[@data-slot='card'][1]")
  // Отбор из рабочего контекста прошлых сессий снимку не нужен.
  await page.getByRole("button", { name: "Сбросить отбор" }).click()
  await page.getByRole("button", { name: "Вузы", exact: true }).click()
  await page.getByPlaceholder("Найти…").fill("МГТУ")
  await page.locator("label", { hasText: "МГТУ им. Баумана" }).locator("input").check()
  await page.keyboard.press("Escape")
  await save((await report.count()) ? report : page, "reports")
  await page.getByRole("button", { name: "Сбросить отбор" }).click()

  // Региональная аналитика: карта по числу обучающихся. Снимается сама
  // карта с легендой — вместе с таблицей блок выше экрана.
  const regions = page.locator("[data-slot='card']", { has: page.getByText("Региональная аналитика", { exact: true }) })
  await scrollContentTo(page, regions)
  await regions.getByRole("button", { name: "Обучается сейчас" }).click()
  const regionMap = page.getByText("Карта регионов", { exact: true }).locator("xpath=ancestor::div[contains(@class,'rounded-xl')][1]")
  await scrollContentTo(page, regionMap)
  await page.mouse.move(5, 5)
  await page.waitForTimeout(800)
  await save(regionMap, "regions")
  await regions.getByRole("button", { name: "Взаимодействий" }).click()

  await open(page, "/calendar")
  await save(page, "calendar")

  await context.close()
}

async function adminShots(browser) {
  const context = await newContext(browser)
  const page = await login(context, ACCOUNTS.admin)

  await open(page, "/admin/users")
  await save(page, "users")

  await page.getByTitle("Настроить доступ к данным").first().click()
  await page.getByLabel("Ограничить: Регионы").check()
  await page.waitForTimeout(300)
  await save(page.getByRole("dialog"), "data-scope")
  await page.getByRole("button", { name: "Отмена" }).click()

  await open(page, "/admin/flow-editor")
  await save(page, "flow-editor")

  await open(page, "/admin/import")
  await save(page, "import")

  await context.close()
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true })
  const browser = await chromium.launch({ channel: CHANNEL })
  console.log(`Снимки ${BASE} → ${OUT_DIR}`)
  try {
    await managerShots(browser)
    await adminShots(browser)
  } finally {
    await browser.close()
  }
  console.log(`Готово: ${shots.length} снимков`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

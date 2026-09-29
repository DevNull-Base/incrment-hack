# Mock Backend — Договорённости по API

> ⚠️ **УСТАРЕЛО.** Источник истины — [`openapi.json`](../openapi.json)
> и [api-contracts.md](api-contracts.md). Файл сохранён как исторический документ хакатона.

> Роли и JWT ниже — исторические заметки хакатона. Актуально: `openapi.json`
> (роли в коде — USER / MANAGER / ADMIN), мок-данные в `src/mock`.

---

## 1. Авторизация (JWT)

### Схема
```
Client → POST /api/auth/login { email, password }
Server → { accessToken, refreshToken, user }
Client → Authorization: Bearer <accessToken>
Server → 401 → Client refreshes via POST /api/auth/refresh { refreshToken }
```

### Токены
| Тип | TTL | Хранение |
|---|---|---|
| **Access Token** | 15 минут | localStorage (или memory) |
| **Refresh Token** | 7 дней | httpOnly cookie (в моках — localStorage) |

### JWT Payload
```json
{
  "sub": "e1",
  "email": "ivanov@rtk.ru",
  "role": "manager",
  "name": "Иванов Алексей Петрович",
  "iat": 1725000000,
  "exp": 1725000900
}
```

### Эндпоинты авторизации
```
POST   /api/auth/login          — вход (email + password)
POST   /api/auth/refresh        — обновление access token
POST   /api/auth/logout         — выход (инвалидация refresh token)
GET    /api/auth/me              — текущий пользователь (из token)
```

---

## 2. Роли и права (RBAC)

### Роли

| Роль | Описание | Уровень доступа |
|---|---|---|
| **admin** | Администратор системы | Полный доступ ко всему, управление пользователями, настройки, аудит |
| **lead** | Руководитель проекта | Все взаимодействия, аналитика, отчёты, просмотр всех вузов и программ |
| **manager** | Менеджер по взаимодействию | Свои взаимодействия, вузы, документы, встречи, уведомления |
| **methodist** | Методист / Куратор | Программы, обучающие материалы, потоки, обучение преподавателей |
| **analyst** | Аналитик | Только чтение: аналитика, отчёты, дашборды, экспорт данных |

### Матрица прав

| Ресурс | admin | lead | manager | methodist | analyst |
|---|---|---|---|---|---|
| **Вузы** (CRUD) | все | все | свои | чтение | чтение |
| **Взаимодействия** (CRUD) | все | все | свои | чтение | чтение |
| **Программы** (CRUD) | все | чтение | чтение | все | чтение |
| **Документы** (CRUD) | все | все | свои | свои | чтение |
| **IT-продукты** (CRUD) | все | чтение | чтение | чтение | чтение |
| **Лицензии** | все | чтение | свои | чтение | чтение |
| **Потоки** | все | чтение | чтение | все | чтение |
| **Заявки** | все | чтение | свои | чтение | чтение |
| **Встречи** | все | все | свои | чтение | нет |
| **Уведомления** | свои | свои | свои | свои | свои |
| **Аналитика** | все | все | огранич. | огранич. | все |
| **Пользователи** | CRUD | просмотр | нет | нет | нет |
| **Аудит-лог** | чтение | чтение | нет | нет | нет |
| **Настройки системы** | все | нет | нет | нет | нет |
| **Экспорт данных** | да | да | свои | нет | да |

### Middleware: проверка прав
```
1. Извлечь JWT из Authorization header
2. Верифицировать подпись (HS256, секрет на сервере)
3. Проверить exp (не истёк)
4. Загрузить пользователя из БД (sub claim)
5. Проверить роль → permissions map
6. Для "своих" ресурсов: WHERE responsibleId = currentUser.id
```

---

## 3. API Endpoints (полный список)

### Auth
```
POST   /api/auth/login                    { email, password } → { accessToken, refreshToken, user }
POST   /api/auth/refresh                  { refreshToken } → { accessToken }
POST   /api/auth/logout                   { refreshToken } → 204
GET    /api/auth/me                       → UserProfile
```

### Users (admin only)
```
GET    /api/users                         → User[]  [admin]
GET    /api/users/:id                     → User    [admin, lead]
POST   /api/users                         { ... } → User  [admin]
PUT    /api/users/:id                     { ... } → User  [admin]
DELETE /api/users/:id                     → 204    [admin]
PUT    /api/users/:id/role                { role } → User  [admin]
```

### Profile (own)
```
GET    /api/profile                       → UserProfile (с stats)
PUT    /api/profile                       { fullName, phone, ... } → UserProfile
PUT    /api/profile/password              { oldPassword, newPassword } → 204
PUT    /api/profile/notifications         NotificationPreferences → 204
```

### Universities
```
GET    /api/universities                  ?search=&region=&status=&type=&page=&limit=  → University[]
GET    /api/universities/:id              → University (с contacts, interactions, documents, licenses)
POST   /api/universities                  { name, shortName, region, city, type, website } → University
PUT    /api/universities/:id              { ... } → University
DELETE /api/universities/:id              → 204
```

### University Contacts
```
GET    /api/universities/:id/contacts     → Contact[]
POST   /api/universities/:id/contacts     { fullName, position, email, phone, role } → Contact
PUT    /api/contacts/:id                  { ... } → Contact
DELETE /api/contacts/:id                  → 204
```

### Interactions
```
GET    /api/interactions                  ?universityId=&programId=&responsibleId=&stage=&page=&limit=  → Interaction[]
GET    /api/interactions/pipeline          → { stage: string, count: number }[] (для Kanban)
GET    /api/interactions/:id              → Interaction (с stages, documents, meetings, timeline)
POST   /api/interactions                  { universityId, programId, productId, responsibleId } → Interaction
PUT    /api/interactions/:id              { notes, responsibleId, ... } → Interaction
PUT    /api/interactions/:id/stage        { stage, status, notes } → Interaction (с валидацией предусловий)
DELETE /api/interactions/:id              → 204
```

### Programs
```
GET    /api/programs                      ?status=&targetAudience=&page=&limit=  → Program[]
GET    /api/programs/:id                  → Program (с streams, applications, interactions, metrics)
POST   /api/programs                      { name, description, direction, targetAudience } → Program
PUT    /api/programs/:id                  { ... } → Program
GET    /api/programs/ranking              → Program[] (отсортированы по метрикам)
```

### IT Products
```
GET    /api/products                      ?search=&licenseType=  → ITProduct[]
GET    /api/products/:id                  → ITProduct (с лицензиями, программами)
POST   /api/products                      { name, version, description, licenseType } → ITProduct
PUT    /api/products/:id                  { ... } → ITProduct
```

### Documents
```
GET    /api/documents                     ?interactionId=&type=&status=&page=&limit=  → Document[]
GET    /api/documents/:id                 → Document (с историей версий)
POST   /api/documents                     { interactionId, type, name } → Document (из шаблона)
PUT    /api/documents/:id                 { name, ... } → Document
PUT    /api/documents/:id/status          { status } → Document (draft→review→signed/rejected)
POST   /api/documents/:id/version         FormData (файл) → Document (новая версия)
```

### Licenses
```
GET    /api/licenses                      ?universityId=&productId=&status=&expiringSoon=  → License[]
GET    /api/licenses/:id                  → License
POST   /api/licenses                      { productId, universityId, type, expiresAt } → License
PUT    /api/licenses/:id                  { ... } → License
```

### Streams
```
GET    /api/streams                       ?programId=&universityId=&status=  → Stream[]
GET    /api/streams/:id                   → Stream
POST   /api/streams                       { programId, universityId, startDate, studentsCount } → Stream
PUT    /api/streams/:id                   { ... } → Stream
```

### Applications
```
GET    /api/applications                  ?source=&programId=&status=&page=&limit=  → Application[]
GET    /api/applications/:id              → Application
POST   /api/applications                  { source, programId, universityId?, applicantName, applicantEmail } → Application
PUT    /api/applications/:id/status       { status } → Application
```

### Meetings
```
GET    /api/meetings                      ?interactionId=&date=&status=  → Meeting[]
GET    /api/meetings/:id                  → Meeting
POST   /api/meetings                      { interactionId, date, participants, agenda } → Meeting
PUT    /api/meetings/:id                  { ... } → Meeting
PUT    /api/meetings/:id/protocol         { protocol } → Meeting
DELETE /api/meetings/:id                  → 204
```

### Notifications
```
GET    /api/notifications                 ?isRead=&type=&page=&limit=  → Notification[]
PUT    /api/notifications/:id/read        → 204
PUT    /api/notifications/read-all        → 204
GET    /api/notifications/count           → { unread: number }
```

### Activity Timeline
```
GET    /api/activity                      ?entityId=&entityType=&page=&limit=  → ActivityEvent[]
```

### Analytics
```
GET    /api/analytics/dashboard           → { kpis, pipeline, alerts }
GET    /api/analytics/ranking             ?period=  → Program[] с метриками
GET    /api/analytics/regions             → { region, universities, interactions, students }[]
GET    /api/analytics/funnel              ?from=&to=  → { stage, count }[] (вычисляется из interactions)
GET    /api/analytics/employees           → { employeeId, interactions, avgDays, completionRate }[]
GET    /api/analytics/export              ?format=csv|xlsx  → File
```

### Audit Log (admin, lead)
```
GET    /api/audit-log                     ?userId=&action=&entityType=&from=&to=&page=&limit=  → AuditLogEntry[]
```

---

## 4. Стандартные ответы

### Успешные
```json
// 200 OK — чтение
{ "data": { ... } }

// 200 OK — список
{ "data": [...], "total": 42, "page": 1, "limit": 20 }

// 201 Created
{ "data": { ... } }

// 204 No Content
// (пустое тело)
```

### Ошибки
```json
// 400 Bad Request
{ "error": { "code": "VALIDATION_ERROR", "message": "Поле 'name' обязательно", "fields": { "name": "Обязательное поле" } } }

// 401 Unauthorized
{ "error": { "code": "UNAUTHORIZED", "message": "Токен истёк или недействителен" } }

// 403 Forbidden
{ "error": { "code": "FORBIDDEN", "message": "Недостаточно прав для этого действия" } }

// 404 Not Found
{ "error": { "code": "NOT_FOUND", "message": "Вуз не найден" } }

// 409 Conflict
{ "error": { "code": "CONFLICT", "message": "Взаимодействие с этим вузом по этой программе уже существует" } }

// 422 Unprocessable Entity
{ "error": { "code": "STAGE_TRANSITION_ERROR", "message": "Нельзя перейти на этап 7 без подписанного документа" } }

// 500 Internal Server Error
{ "error": { "code": "INTERNAL_ERROR", "message": "Внутренняя ошибка сервера" } }
```

---

## 5. Валидация переходов этапов (Business Rules)

```typescript
// Правила перехода между этапами workflow
const STAGE_PRECONDITIONS: Record<WorkflowStage, { requires: WorkflowStage[] }> = {
  search_contacts:           { requires: [] },
  communication:             { requires: ["search_contacts"] },
  meeting:                   { requires: ["communication"] },
  document_exchange:         { requires: ["meeting"] },
  document_revision:         { requires: ["document_exchange"] },  // опциональный
  document_signing:          { requires: ["document_exchange"] },  // минуя revision
  materials_transfer:        { requires: ["document_signing"] },
  implementation_support:    { requires: ["materials_transfer"] },
  teacher_training:          { requires: ["implementation_support"] },
  program_update:            { requires: ["teacher_training"] },
  classes_running:           { requires: ["program_update"] },
  documentation_update:      { requires: ["materials_transfer"] }, // параллельный
  teacher_advanced_training: { requires: ["teacher_training"] },   // параллельный
  stage_control:             { requires: [] },                      // сквозной
}
```

---

## 6. Моковые данные для авторизации

### Тестовые учётные записи
| Email | Пароль | Роль | Имя |
|---|---|---|---|
| admin@rtk.ru | admin123 | admin | Админ Системы |
| sidorov@rtk.ru | lead123 | lead | Сидоров Дмитрий Олегович |
| ivanov@rtk.ru | manager123 | manager | Иванов Алексей Петрович |
| petrova@rtk.ru | manager123 | manager | Петрова Мария Сергеевна |
| kozlova@rtk.ru | methodist123 | methodist | Козлова Елена Викторовна |

### Текущий моковый токен (для фронтенда без бекенда)
```
eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.
eyJzdWIiOiJlMSIsImVtYWlsIjoiaXZhbm92QHJ0ay5ydSIsInJvbGUiOiJtYW5hZ2VyIiwibmFtZSI6ItCY0LLQsNC90L7QsiDQkNC70LXQutGB0LkgnJ9QZXRyb3ZpY2giLCJpYXQiOjE3MjUwMDAwMDAsImV4cCI6MTcyNTAwMDkwMH0.
fake-signature
```

---

## 7. Интеграции (заглушки)

### LMS
```
GET    /api/integrations/lms/status       → { connected: boolean, lastSync: string }
POST   /api/integrations/lms/sync         → { synced: number, errors: number }
GET    /api/integrations/lms/courses      → Course[] (курсы из LMS)
GET    /api/integrations/lms/progress/:teacherId  → Progress (прогресс преподавателя)
```

### Сайт ИТ-Школы
```
POST   /api/integrations/website/leads    → Application (приём заявок с сайта, без auth)
```

### Email (SMTP)
```
POST   /api/integrations/email/send       { to, subject, body, interactionId? } → 204
GET    /api/integrations/email/templates   → Template[]
```

---

## 8. Headers

### Запрос
```
Authorization: Bearer <accessToken>
Content-Type: application/json
X-Request-ID: <uuid>          // для трейсинга
```

### Ответ
```
X-Request-ID: <uuid>
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 97
X-RateLimit-Reset: 1725000900
```

---

## 9. Rate Limiting

| Роль | Лимит запросов/мин |
|---|---|
| admin | 300 |
| lead | 200 |
| manager | 150 |
| methodist | 100 |
| analyst | 100 |
| Без авторизации (login) | 10 |

---

## 10. Безопасность (требования 152-ФЗ + ФСТЭК № 117)

### 152-ФЗ «О персональных данных»
- Все ПД хранятся только на территории РФ
- Шифрование при передаче (HTTPS/TLS 1.2+)
- Шифрование в покое (AES-256 для чувствительных полей)
- Согласие на обработку ПД при создании контакта/преподавателя
- Возможность удаления ПД по запросу (право на забвение)
- Логирование всех обращений к ПД

### ФСТЭК № 117
- Аудит всех действий пользователей (AuditLogEntry)
- Управление учётными записями (блокировка, смена пароля)
- Разграничение прав доступа (RBAC матрица выше)
- Журналирование событий безопасности (неудачные логины, попытки доступа)
- Пароли: минимум 8 символов, буквы + цифры, хеширование bcrypt

### API Security
- CORS: разрешённые origins из конфига
- CSP headers
- SQL injection: параметризованные запросы (ORM)
- XSS: экранирование вывода
- CSRF: SameSite cookie для refresh token

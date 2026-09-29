-- ============================================================================
--  Базовые процессы взаимодействия
--
--  Процесс из 14 шагов описан в разделе 2 технического задания, а маршрут
--  прямых продаж вытекает из ответов постановщика: это часть поставки,
--  а не демонстрационные данные. Раньше оба приходили только наполнением
--  базы, и развёрнутый экземпляр без этого шага не давал завести ни одной
--  заявки — «не найден действующий шаблон процесса».
--
--  Определения перенесены снимком из src/modules/workflow/base-template.ts.
--  Миграция — снимок по своей природе: дальнейшие изменения схемы процесса
--  вносятся через редактор и публикацию, а не правкой этого файла.
--
--  Вставка пропускается, если в сегменте уже действует какая-либо редакция:
--  на работающем стенде администратор мог опубликовать свою, и подменять
--  её базовой нельзя. Повторное применение безопасно.
-- ============================================================================

-- B2B: Взаимодействие с вузом (базовый процесс)
INSERT INTO "workflow_template" (
  "id", "key", "version", "segment", "name", "description",
  "definition", "is_active", "is_default", "published_at", "created_at", "updated_at"
)
SELECT
  '9e5b1a10-0000-4000-8000-000000000001'::uuid,
  'university-engagement',
  1,
  'B2B'::"EngagementSegment",
  'Взаимодействие с вузом (базовый процесс)',
  'Типовой путь из 14 шагов согласно техническому заданию',
  '{"states":[{"key":"CONTACT_SEARCH","label":"Поиск контактов","description":"Поиск ответственного лица в вузе","order":0,"isInitial":true,"isFinal":false,"slaDays":14,"requiresAttachment":false},{"key":"COMMUNICATION","label":"Коммуникация","description":"Уточнение актуальности программ по ИТ-направлениям","order":1,"isInitial":false,"isFinal":false,"slaDays":10,"requiresAttachment":false},{"key":"MEETING","label":"Организация встречи","description":"Встреча с представителями вуза","order":2,"isInitial":false,"isFinal":false,"slaDays":21,"requiresAttachment":false},{"key":"DOCUMENTS_EXCHANGE","label":"Обмен документами","description":"Передача пакета документов для подписания","order":3,"isInitial":false,"isFinal":false,"slaDays":14,"requiresAttachment":true},{"key":"DOCUMENTS_REVISION","label":"Корректировка документов","description":"Необязательный этап: правки до подписания","order":4,"isInitial":false,"isFinal":false,"slaDays":10,"requiresAttachment":false},{"key":"SIGNING","label":"Подписание документов","description":"Подписание согласованного пакета документов","order":5,"isInitial":false,"isFinal":false,"slaDays":21,"requiresAttachment":true},{"key":"MATERIALS_TRANSFER","label":"Передача материалов","description":"Передача обучающих материалов, лицензии и документации","order":6,"isInitial":false,"isFinal":false,"slaDays":14,"requiresAttachment":true},{"key":"IMPLEMENTATION","label":"Внедрение продукта","description":"Сопровождение внедрения ИТ-продукта в вузе","order":7,"isInitial":false,"isFinal":false,"slaDays":30,"requiresAttachment":false},{"key":"TEACHER_TRAINING","label":"Обучение преподавателей","description":"Подготовка преподавательского состава","order":8,"isInitial":false,"isFinal":false,"slaDays":45,"requiresAttachment":false},{"key":"PROGRAM_UPDATE","label":"Актуализация программы","description":"Обновление учебной программы с учётом продукта","order":9,"isInitial":false,"isFinal":false,"slaDays":30,"requiresAttachment":false},{"key":"CLASSES","label":"Ведение занятий","description":"Проведение занятий по актуализированной программе","order":10,"isInitial":false,"isFinal":false,"slaDays":120,"requiresAttachment":false},{"key":"DOCS_UPDATE","label":"Актуализация документации","description":"Обновление документации по продукту и материалов","order":11,"isInitial":false,"isFinal":false,"slaDays":30,"requiresAttachment":false},{"key":"QUALIFICATION","label":"Повышение квалификации","description":"Повышение квалификации преподавателей","order":12,"isInitial":false,"isFinal":false,"slaDays":60,"requiresAttachment":false},{"key":"SUPPORT","label":"Сопровождение","description":"Взаимодействие вышло на регулярное сопровождение","order":13,"isInitial":false,"isFinal":true,"requiresAttachment":false},{"key":"REJECTED","label":"Отказ","description":"Вуз отказался от сотрудничества либо работа прекращена","order":14,"isInitial":false,"isFinal":true,"requiresAttachment":false}],"transitions":[{"from":"CONTACT_SEARCH","to":"COMMUNICATION","label":"Контакт установлен","requiresComment":false,"allowedRoles":[]},{"from":"COMMUNICATION","to":"MEETING","label":"Назначить встречу","requiresComment":false,"allowedRoles":[]},{"from":"MEETING","to":"DOCUMENTS_EXCHANGE","label":"Встреча проведена","requiresComment":true,"allowedRoles":[]},{"from":"DOCUMENTS_EXCHANGE","to":"DOCUMENTS_REVISION","label":"Требуются правки","requiresComment":true,"allowedRoles":[]},{"from":"DOCUMENTS_EXCHANGE","to":"SIGNING","label":"Документы согласованы","requiresComment":false,"allowedRoles":[]},{"from":"DOCUMENTS_REVISION","to":"SIGNING","label":"Правки внесены","requiresComment":true,"allowedRoles":[]},{"from":"DOCUMENTS_REVISION","to":"DOCUMENTS_EXCHANGE","label":"Вернуть на согласование","requiresComment":true,"allowedRoles":[]},{"from":"SIGNING","to":"MATERIALS_TRANSFER","label":"Документы подписаны","requiresComment":false,"allowedRoles":[]},{"from":"MATERIALS_TRANSFER","to":"IMPLEMENTATION","label":"Материалы переданы","requiresComment":false,"allowedRoles":[]},{"from":"IMPLEMENTATION","to":"TEACHER_TRAINING","label":"Продукт внедрён","requiresComment":false,"allowedRoles":[]},{"from":"TEACHER_TRAINING","to":"PROGRAM_UPDATE","label":"Преподаватели обучены","requiresComment":false,"allowedRoles":[]},{"from":"PROGRAM_UPDATE","to":"CLASSES","label":"Программа актуализирована","requiresComment":false,"allowedRoles":[]},{"from":"CLASSES","to":"DOCS_UPDATE","label":"Занятия идут","requiresComment":false,"allowedRoles":[]},{"from":"DOCS_UPDATE","to":"QUALIFICATION","label":"Документация обновлена","requiresComment":false,"allowedRoles":[]},{"from":"QUALIFICATION","to":"SUPPORT","label":"Перевести в сопровождение","requiresComment":false,"allowedRoles":[]},{"from":"CONTACT_SEARCH","to":"REJECTED","label":"Отказ","requiresComment":true,"allowedRoles":["MANAGER","ADMIN"]},{"from":"COMMUNICATION","to":"REJECTED","label":"Отказ","requiresComment":true,"allowedRoles":["MANAGER","ADMIN"]},{"from":"MEETING","to":"REJECTED","label":"Отказ","requiresComment":true,"allowedRoles":["MANAGER","ADMIN"]},{"from":"DOCUMENTS_EXCHANGE","to":"REJECTED","label":"Отказ","requiresComment":true,"allowedRoles":["MANAGER","ADMIN"]},{"from":"DOCUMENTS_REVISION","to":"REJECTED","label":"Отказ","requiresComment":true,"allowedRoles":["MANAGER","ADMIN"]}]}'::jsonb,
  true,
  true,
  now(),
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "workflow_template"
  WHERE "segment" = 'B2B'::"EngagementSegment"
    AND "is_active"
    AND "is_default"
)
AND NOT EXISTS (
  SELECT 1 FROM "workflow_template"
  WHERE "key" = 'university-engagement' AND "version" = 1
);

-- B2C: Прямая работа с обучающимся (B2C)
INSERT INTO "workflow_template" (
  "id", "key", "version", "segment", "name", "description",
  "definition", "is_active", "is_default", "published_at", "created_at", "updated_at"
)
SELECT
  '9e5b1a10-0000-4000-8000-000000000002'::uuid,
  'direct-sales',
  1,
  'B2C'::"EngagementSegment",
  'Прямая работа с обучающимся (B2C)',
  'Маршрут прямых продаж: заявка, оплата, доступ, обучение',
  '{"states":[{"key":"REQUEST","label":"Заявка","description":"Поступило обращение с сайта, из LMS либо напрямую","order":0,"isInitial":true,"isFinal":false,"slaDays":3,"requiresAttachment":false},{"key":"QUALIFICATION","label":"Квалификация","description":"Уточнение потребности и подбор программы обучения","order":1,"isInitial":false,"isFinal":false,"slaDays":7,"requiresAttachment":false},{"key":"OFFER","label":"Предложение","description":"Направлены условия обучения и стоимость","order":2,"isInitial":false,"isFinal":false,"slaDays":7,"requiresAttachment":false},{"key":"CONTRACT","label":"Договор и оплата","description":"Оформление документов и подтверждение оплаты","order":3,"isInitial":false,"isFinal":false,"slaDays":10,"requiresAttachment":true},{"key":"ACCESS_GRANTED","label":"Доступ выдан","description":"Учётная запись заведена, материалы открыты в LMS","order":4,"isInitial":false,"isFinal":false,"slaDays":3,"requiresAttachment":false},{"key":"LEARNING","label":"Обучение","description":"Слушатель проходит программу","order":5,"isInitial":false,"isFinal":false,"slaDays":180,"requiresAttachment":false},{"key":"COMPLETED","label":"Обучение завершено","description":"Программа пройдена, документ об обучении выдан","order":6,"isInitial":false,"isFinal":true,"requiresAttachment":false},{"key":"REJECTED","label":"Отказ","description":"Контрагент отказался либо обращение не состоялось","order":7,"isInitial":false,"isFinal":true,"requiresAttachment":false}],"transitions":[{"from":"REQUEST","to":"QUALIFICATION","label":"Взять в работу","requiresComment":false,"allowedRoles":[]},{"from":"QUALIFICATION","to":"OFFER","label":"Направить предложение","requiresComment":false,"allowedRoles":[]},{"from":"OFFER","to":"CONTRACT","label":"Предложение принято","requiresComment":false,"allowedRoles":[]},{"from":"OFFER","to":"QUALIFICATION","label":"Пересобрать предложение","requiresComment":true,"allowedRoles":[]},{"from":"CONTRACT","to":"ACCESS_GRANTED","label":"Оплата подтверждена","requiresComment":false,"allowedRoles":[]},{"from":"ACCESS_GRANTED","to":"LEARNING","label":"Обучение начато","requiresComment":false,"allowedRoles":[]},{"from":"LEARNING","to":"COMPLETED","label":"Обучение завершено","requiresComment":false,"allowedRoles":[]},{"from":"REQUEST","to":"REJECTED","label":"Отказ","requiresComment":true,"allowedRoles":[]},{"from":"QUALIFICATION","to":"REJECTED","label":"Отказ","requiresComment":true,"allowedRoles":[]},{"from":"OFFER","to":"REJECTED","label":"Отказ","requiresComment":true,"allowedRoles":[]},{"from":"CONTRACT","to":"REJECTED","label":"Отказ","requiresComment":true,"allowedRoles":["MANAGER","ADMIN"]},{"from":"LEARNING","to":"REJECTED","label":"Прекращение обучения","requiresComment":true,"allowedRoles":["MANAGER","ADMIN"]}]}'::jsonb,
  true,
  true,
  now(),
  now(),
  now()
WHERE NOT EXISTS (
  SELECT 1 FROM "workflow_template"
  WHERE "segment" = 'B2C'::"EngagementSegment"
    AND "is_active"
    AND "is_default"
)
AND NOT EXISTS (
  SELECT 1 FROM "workflow_template"
  WHERE "key" = 'direct-sales' AND "version" = 1
);

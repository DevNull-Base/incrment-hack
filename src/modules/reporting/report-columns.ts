/**
 * Белый список колонок отчёта.
 *
 * Это граница безопасности конструктора отчётов. Пользователь передаёт
 * только КЛЮЧИ из этого перечня; соответствующее выражение SQL берётся
 * отсюда и в запрос не подставляется из запроса клиента ни при каких
 * условиях. Приняв имя колонки от клиента напрямую, конструктор отчётов
 * превратился бы в произвольное выполнение SQL — а он по замыслу доступен
 * каждому пользователю системы.
 *
 * Состав колонок покрывает требование ТЗ («наименование вуза,
 * ИТ-направление, ИТ-продукт, статус работы с вузом, ответственный»)
 * и дополнен полями, без которых отчёт трудно читать.
 */

export type ColumnType = 'text' | 'date' | 'datetime' | 'number' | 'boolean';

export interface ReportColumn {
  /** Подпись в шапке отчёта. */
  readonly label: string;
  /**
   * Выражение SQL. Задаётся здесь и только здесь.
   * Использует псевдонимы таблиц, объявленные в построителе запроса.
   */
  readonly expression: string;
  readonly type: ColumnType;
  /** Ширина колонки в символах — влияет на вёрстку xlsx и pdf. */
  readonly width: number;
  /** Пояснение для документации и подсказок в интерфейсе. */
  readonly description: string;
}

export const REPORT_COLUMNS = {
  segment: {
    label: 'Сегмент',
    expression: `CASE e.segment WHEN 'B2B' THEN 'Работа с вузами' ELSE 'Прямые продажи' END`,
    type: 'text',
    width: 20,
    description: 'Работа с учебными заведениями либо прямые продажи',
  },
  counterparty: {
    label: 'Контрагент',
    expression: 'coalesce(u.name, e.counterparty_name)',
    type: 'text',
    width: 45,
    description:
      'Вуз для взаимодействий B2B, наименование лица для прямых продаж. ' +
      'Колонка сводит оба сегмента в один отчёт.',
  },
  universityName: {
    label: 'Наименование вуза',
    expression: 'u.name',
    type: 'text',
    width: 45,
    description: 'Полное наименование учебного заведения',
  },
  universityShortName: {
    label: 'Сокращение',
    expression: 'u.short_name',
    type: 'text',
    width: 18,
    description: 'Сокращённое наименование вуза',
  },
  universityRegion: {
    label: 'Регион',
    expression: 'u.region',
    type: 'text',
    width: 25,
    description: 'Регион расположения вуза',
  },
  universityCity: {
    label: 'Город',
    expression: 'u.city',
    type: 'text',
    width: 20,
    description: 'Город расположения вуза',
  },
  directionName: {
    label: 'ИТ-направление',
    expression: 'd.name',
    type: 'text',
    width: 30,
    description: 'Направление обучения: DevOps, QA и другие',
  },
  productName: {
    label: 'ИТ-продукт',
    expression: 'p.name',
    type: 'text',
    width: 30,
    description: 'Программное обеспечение, передаваемое вузу',
  },
  vendorName: {
    label: 'Вендор',
    expression: 'v.name',
    type: 'text',
    width: 22,
    description: 'Производитель программного обеспечения',
  },
  programName: {
    label: 'ИТ-программа',
    expression: 'pr.name',
    type: 'text',
    width: 32,
    description: 'Учебная программа по направлению',
  },
  stateLabel: {
    label: 'Статус работы',
    expression: 'e.current_state_label',
    type: 'text',
    width: 26,
    description: 'Текущий этап взаимодействия с вузом',
  },
  interestLevel: {
    label: 'Заинтересованность',
    // Порядок перечисления в базе — LOW, MEDIUM, HIGH, поэтому сортировка
    // по исходной колонке совпадает со смыслом; в отчёт идёт русская подпись.
    expression: `CASE e.interest_level
      WHEN 'HIGH' THEN 'Высокая'
      WHEN 'MEDIUM' THEN 'Средняя'
      WHEN 'LOW' THEN 'Низкая'
      ELSE NULL END`,
    type: 'text',
    width: 18,
    description:
      'Оценка заинтересованности контрагента в программе, которую ставит КАМ. ' +
      'Пусто — оценки нет.',
  },
  interestComment: {
    label: 'Обоснование оценки',
    expression: 'e.interest_comment',
    type: 'text',
    width: 40,
    description: 'Почему контрагент заинтересован или нет — со слов КАМа',
  },
  ownerName: {
    label: 'Ответственный',
    expression: 'o.display_name',
    type: 'text',
    width: 24,
    description: 'Менеджер, отвечающий за взаимодействие',
  },
  ownerEmail: {
    label: 'Почта ответственного',
    expression: 'o.email',
    type: 'text',
    width: 28,
    description: 'Адрес электронной почты ответственного',
  },
  createdAt: {
    label: 'Создано',
    expression: 'e.created_at',
    type: 'datetime',
    width: 18,
    description: 'Дата начала взаимодействия',
  },
  updatedAt: {
    label: 'Изменено',
    expression: 'e.updated_at',
    type: 'datetime',
    width: 18,
    description: 'Дата последнего изменения',
  },
  slaDueAt: {
    label: 'Срок этапа',
    expression: 'wi.sla_due_at',
    type: 'datetime',
    width: 18,
    description: 'Норматив завершения текущего этапа',
  },
  isOverdue: {
    label: 'Просрочено',
    // Завершённое взаимодействие просроченным не считается, даже если
    // норматив последнего этапа формально истёк.
    expression:
      '(wi.completed_at IS NULL AND wi.sla_due_at IS NOT NULL AND wi.sla_due_at < now())',
    type: 'boolean',
    width: 12,
    description: 'Признак нарушения норматива по текущему этапу',
  },
  daysInState: {
    label: 'Дней в статусе',
    expression: 'EXTRACT(DAY FROM (now() - wi.entered_at))::int',
    type: 'number',
    width: 14,
    description: 'Сколько дней взаимодействие находится в текущем статусе',
  },
  transitionCount: {
    label: 'Переходов',
    expression:
      '(SELECT count(*)::int FROM workflow_transition wt WHERE wt.instance_id = wi.id)',
    type: 'number',
    width: 12,
    description: 'Число выполненных переходов по процессу',
  },
  contractNumber: {
    label: 'Номер договора',
    expression: 'c.number',
    type: 'text',
    width: 22,
    description: 'Номер договора с вузом',
  },
  contractSignedAt: {
    label: 'Дата договора',
    expression: 'c.signed_at',
    type: 'date',
    width: 16,
    description: 'Дата подписания договора',
  },
  licenseValidUntil: {
    label: 'Лицензия до',
    expression: 'l.valid_until',
    type: 'date',
    width: 16,
    description: 'Дата окончания действия лицензии',
  },
  licenseTransferStatus: {
    label: 'Статус передачи',
    // Значения перечисления переводятся на русский прямо в запросе:
    // отчёт предназначен людям, а не выгружается в другую систему.
    expression: `CASE l.transfer_status
      WHEN 'NOT_STARTED' THEN 'Не начата'
      WHEN 'IN_PROGRESS' THEN 'В работе'
      WHEN 'TRANSFERRED' THEN 'Передана'
      WHEN 'REJECTED' THEN 'Отказ'
      ELSE NULL END`,
    type: 'text',
    width: 18,
    description: 'Состояние передачи лицензии вузу',
  },
  contactNames: {
    label: 'Ответственные от вуза',
    expression: `(SELECT string_agg(pe.full_name, '; ' ORDER BY pe.full_name)
      FROM university_contact uc
      JOIN person pe ON pe.id = uc.person_id
      WHERE uc.university_id = u.id)`,
    type: 'text',
    width: 40,
    description: 'Контактные лица со стороны вуза',
  },
} as const satisfies Record<string, ReportColumn>;

export type ReportColumnKey = keyof typeof REPORT_COLUMNS;

export const REPORT_COLUMN_KEYS = Object.keys(REPORT_COLUMNS) as ReportColumnKey[];

/** Колонки по умолчанию — соответствуют перечню из ТЗ. */
export const DEFAULT_REPORT_COLUMNS: ReportColumnKey[] = [
  'universityName',
  'directionName',
  'productName',
  'stateLabel',
  'ownerName',
];

/** Проверяет, что ключ принадлежит белому списку. */
export function isReportColumn(key: string): key is ReportColumnKey {
  return Object.prototype.hasOwnProperty.call(REPORT_COLUMNS, key);
}

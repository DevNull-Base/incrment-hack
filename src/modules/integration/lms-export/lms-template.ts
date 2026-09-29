import ExcelJS from 'exceljs';

/**
 * Шаблон загрузки слушателей в LMS.
 *
 * Заголовки воспроизведены по шаблону заказчика БУКВАЛЬНО, включая
 * потерянные открывающие скобки («Отчествопри наличии)»): загрузчик LMS
 * может сопоставлять колонки по тексту заголовка, и «исправленный» файл
 * он бы не принял. Если LMS читает колонки по порядку, исправление
 * заголовков ничего не сломает — но это решается с владельцем LMS,
 * а не догадкой.
 */
export const LMS_TEMPLATE_HEADERS = [
  'Фамилия',
  'Имя',
  'Отчествопри наличии)',
  'Номер телефона',
  'Email',
  'СНИЛС',
  'Серия паспорта',
  'Номер паспорта',
  'Кем выдан паспорт',
  'Дата выдачи паспорта',
  'Код подразделения',
  'Пол',
  'Дата рождения',
  'Регион регистрации',
  'Населенный пункт регистрации',
  'Улица регистрации',
  'Дом регистрации',
  'Квартира регистрации',
  'Индекс регистрации',
  'Имядательный падеж)',
  'Фамилиядательный падеж)',
  'Отчестводательный падеж)',
  'Образование',
  'Профессия по диплому',
  'Учебное заведение по диплому',
  'Фамилия, указанная в дипломе',
  'Номер диплома',
  'Серия диплома',
  'Регистрационный номер диплома',
  'Дата выдачи диплома',
] as const;

/** Справочники второго листа шаблона. */
export const LMS_GENDERS = ['М', 'Ж'] as const;

export const LMS_EDUCATION_LEVELS = [
  'Без образования',
  'Основное общее образование - 9 классов',
  'Среднее общее образование - 11 классов',
  'Среднее профессиональное образование',
  'Высшее образование – бакалавриат',
  'Высшее образование – специалитет, магистратура',
  'Высшее образование – подготовка кадров высшей квалификации',
] as const;

/** Ширина колонок — как в шаблоне заказчика. */
const COLUMN_WIDTHS = [
  23.9, 24.9, 24, 22.1, 20.7, 14.7, 14.6, 15.9, 19.6, 20.4, 18.4, 9.1, 15.3, 18.1, 29.1, 17.7, 16.3,
  20.3, 19, 23, 27, 26.1, 37.1, 21.4, 29.6, 29, 15.3, 14.9, 31, 22,
];

/**
 * Строка выгрузки. CRM заполняет только первые пять колонок: паспорт,
 * СНИЛС, адрес регистрации и сведения о дипломе CRM не собирает — это
 * данные, которые слушатель вносит в LMS сам, а хранить их в CRM без
 * необходимости запрещает принцип минимизации (ч. 5 ст. 5 152-ФЗ).
 */
export interface LmsLearnerRow {
  lastName: string;
  firstName: string;
  middleName: string | null;
  /** +7XXXXXXXXXX либо null. */
  phone: string | null;
  email: string;
}

/**
 * Собирает файл загрузки в LMS.
 *
 * Телефон записывается числом 7XXXXXXXXXX — так он записан в образце
 * заказчика; в текстовом виде со знаком «+» загрузчик мог бы его не
 * принять. Колонки «Пол» и «Образование» получают выпадающие списки из
 * второго листа: оставшиеся колонки заполняют люди, и список защищает
 * от «муж.» и «высшее» вместо допустимых значений.
 */
export async function buildLmsWorkbook(rows: readonly LmsLearnerRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'CRM ИТ Школы РТК';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Лист1');
  const dictionaries = workbook.addWorksheet('Лист2');

  sheet.columns = LMS_TEMPLATE_HEADERS.map((header, index) => ({
    header,
    width: COLUMN_WIDTHS[index] ?? 18,
  }));

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, name: 'Calibri', size: 11 };
  headerRow.alignment = { horizontal: 'center' };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];

  for (const row of rows) {
    const phoneDigits = row.phone ? row.phone.replace(/\D/g, '') : null;

    sheet.addRow([
      row.lastName,
      row.firstName,
      row.middleName ?? '',
      phoneDigits ? Number(phoneDigits) : '',
      row.email,
    ]);
  }

  // Число без экспоненты: 79001112233, а не 7,999E+10.
  sheet.getColumn(4).numFmt = '0';

  LMS_GENDERS.forEach((value, index) => {
    dictionaries.getCell(index + 1, 1).value = value;
  });
  LMS_EDUCATION_LEVELS.forEach((value, index) => {
    dictionaries.getCell(index + 1, 2).value = value;
  });
  dictionaries.getColumn(2).width = 60;

  const lastRow = Math.max(rows.length + 1, 1000);
  const genderColumn = LMS_TEMPLATE_HEADERS.indexOf('Пол') + 1;
  const educationColumn = LMS_TEMPLATE_HEADERS.indexOf('Образование') + 1;

  for (let rowNumber = 2; rowNumber <= lastRow; rowNumber++) {
    sheet.getCell(rowNumber, genderColumn).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`'Лист2'!$A$1:$A$${LMS_GENDERS.length}`],
    };
    sheet.getCell(rowNumber, educationColumn).dataValidation = {
      type: 'list',
      allowBlank: true,
      formulae: [`'Лист2'!$B$1:$B$${LMS_EDUCATION_LEVELS.length}`],
    };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Делит ФИО на части для колонок шаблона.
 *
 * В реестре персональных данных ФИО хранится одной строкой. Первое слово —
 * фамилия, второе — имя, остальное — отчество: так «Мамедов Эльдар Рашид
 * оглы» даёт отчество «Рашид оглы», а не теряет «оглы». Двойная фамилия
 * через дефис остаётся одним словом.
 */
export function splitFullName(fullName: string): { lastName: string; firstName: string; middleName: string | null } | null {
  const parts = fullName.trim().split(/\s+/).filter((part) => part.length > 0);

  if (parts.length < 2) {
    return null;
  }

  const [lastName, firstName, ...rest] = parts as [string, string, ...string[]];
  return { lastName, firstName, middleName: rest.length > 0 ? rest.join(' ') : null };
}

import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PassThrough, Readable } from 'node:stream';
import ExcelJS from 'exceljs';
import * as XLSX from 'xlsx';
import { AppException } from '../../common/errors/app-exception.js';
import { REPORT_COLUMNS, ReportColumnKey } from './report-columns.js';

/** Предел книги Excel 97-2003: 65 536 строк вместе с заголовком. */
const BIFF8_MAX_ROWS = 65_536;

export type ReportFormat = 'XLSX' | 'XLS' | 'PDF' | 'CSV' | 'JSON';

export interface RenderContext {
  title: string;
  columns: ReportColumnKey[];
  /** Описание применённых фильтров — печатается в шапке отчёта. */
  filterSummary: string[];
  generatedBy: string;
  generatedAt: Date;
  rowCount: number;
}

/** Поставщик строк: позволяет отдавать данные порциями, не собирая их целиком. */
export type RowSupplier = () => AsyncGenerator<Record<string, unknown>, void, unknown>;

@Injectable()
export class ReportRendererService {
  /** Настроенный экземпляр pdfmake; готовится однократно. */
  private pdfMake?: PdfMakeInstance;

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(ReportRendererService.name);
  }

  /**
   * Формирует XLSX потоковой записью.
   *
   * Строки уходят в поток по мере поступления и в памяти не накапливаются,
   * поэтому расход памяти не зависит от объёма отчёта. Для требования ТЗ
   * о десяти параллельных отчётах это принципиально: иначе десять выгрузок
   * по полмиллиона строк одновременно исчерпали бы память процесса.
   */
  renderXlsx(context: RenderContext, rows: RowSupplier): Readable {
    const output = new PassThrough();

    void this.writeXlsx(context, rows, output).catch((error: unknown) => {
      this.logger.error({ err: error }, 'Ошибка формирования XLSX');
      output.destroy(error instanceof Error ? error : new Error('Ошибка формирования отчёта'));
    });

    return output;
  }

  private async writeXlsx(
    context: RenderContext,
    rows: RowSupplier,
    output: PassThrough,
  ): Promise<void> {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: output,
      useStyles: true,
      useSharedStrings: false,
    });

    workbook.creator = 'CRM ИТ Школа РТК';
    workbook.created = context.generatedAt;

    const sheet = workbook.addWorksheet('Отчёт', {
      views: [{ state: 'frozen', ySplit: context.filterSummary.length + 3 }],
    });

    sheet.columns = context.columns.map((key) => ({
      key,
      width: REPORT_COLUMNS[key].width,
    }));

    // Шапка с параметрами выборки: отчёт часто пересылают по почте,
    // и без указания фильтров и даты он теряет смысл — по нему
    // невозможно понять, за какой период и по каким данным он построен.
    const titleRow = sheet.addRow([context.title]);
    titleRow.font = { bold: true, size: 14 };
    titleRow.commit();

    for (const line of context.filterSummary) {
      sheet.addRow([line]).commit();
    }

    sheet
      .addRow([
        `Сформирован: ${formatDateTime(context.generatedAt)} · ${context.generatedBy} · строк: ${context.rowCount}`,
      ])
      .commit();

    sheet.addRow([]).commit();

    const headerRow = sheet.addRow(context.columns.map((key) => REPORT_COLUMNS[key].label));
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8EEF7' },
    };
    headerRow.alignment = { vertical: 'middle', wrapText: true };
    headerRow.commit();

    // Нейтрализация формул здесь не нужна: ExcelJS записывает строку как
    // строковое значение ячейки, а формулой считает только объект вида
    // { formula }. Опасность существует лишь в текстовых форматах, где
    // тип ячейки определяет уже сам Excel при открытии, — см. csvEscape.
    for await (const row of rows()) {
      const values = context.columns.map((key) => formatCell(row[key], key));
      sheet.addRow(values).commit();
    }

    sheet.commit();
    await workbook.commit();
  }

  /**
   * Формирует CSV.
   *
   * Разделитель — точка с запятой, кодировка с BOM: Excel в русской
   * локали открывает файл с запятой как одну колонку, а без BOM
   * показывает кириллицу нечитаемой.
   */
  renderCsv(context: RenderContext, rows: RowSupplier): Readable {
    return Readable.from(
      (async function* () {
        yield '﻿';
        yield context.columns.map((key) => csvEscape(REPORT_COLUMNS[key].label)).join(';') + '\r\n';

        for await (const row of rows()) {
          yield (
            context.columns.map((key) => csvEscape(formatCell(row[key], key))).join(';') + '\r\n'
          );
        }
      })(),
    );
  }

  /**
   * Формирует книгу Excel 97-2003 (BIFF8).
   *
   * Формат снят с поддержки самим разработчиком, но заказчик подтвердил,
   * что файлы ходят и в нём: «приходить оно может и так, и так». Прежде
   * выгрузка отдавала xlsx под расширением .xls — современный Excel такой
   * документ открывает, а вот системы, ради которых старый формат и нужен,
   * не читают его вовсе.
   *
   * Запись, в отличие от xlsx, не потоковая: BIFF8 хранит общую таблицу
   * строк и смещения записей, поэтому книга собирается целиком в памяти.
   * Ограничение формата — 65 536 строк вместе с заголовком; при выходе
   * за него отчёт отклоняется с указанием выбрать xlsx, а не молча
   * обрезается.
   */
  renderXls(context: RenderContext, rows: RowSupplier): Readable {
    const output = new PassThrough();

    void this.writeXls(context, rows, output).catch((error: unknown) => {
      if (error instanceof AppException) {
        output.destroy(error);
        return;
      }

      this.logger.error({ err: error }, 'Ошибка формирования XLS');
      output.destroy(error instanceof Error ? error : new Error('Ошибка формирования отчёта'));
    });

    return output;
  }

  private async writeXls(
    context: RenderContext,
    rows: RowSupplier,
    output: PassThrough,
  ): Promise<void> {
    const header = context.columns.map((key) => REPORT_COLUMNS[key].label);
    const matrix: unknown[][] = [header];

    for await (const row of rows()) {
      if (matrix.length >= BIFF8_MAX_ROWS) {
        throw new AppException('REPORT_TOO_LARGE', {
          detail:
            `Формат Excel 97-2003 вмещает не более ${BIFF8_MAX_ROWS} строк. ` +
            'Выберите xlsx либо сузьте отбор.',
          meta: { maxRows: BIFF8_MAX_ROWS, format: 'XLS' },
        });
      }

      matrix.push(context.columns.map((key) => formatCell(row[key], key)));
    }

    const sheet = XLSX.utils.aoa_to_sheet(matrix);
    sheet['!cols'] = context.columns.map((key) => ({ wch: REPORT_COLUMNS[key].width }));

    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Отчёт');

    const buffer = XLSX.write(book, { type: 'buffer', bookType: 'biff8' }) as Buffer;

    output.end(buffer);
  }

  /** Формирует JSON — требование ТЗ о результирующем json-файле. */
  renderJson(context: RenderContext, rows: RowSupplier): Readable {
    return Readable.from(
      (async function* () {
        yield '{\n';
        yield `  "title": ${JSON.stringify(context.title)},\n`;
        yield `  "generatedAt": ${JSON.stringify(context.generatedAt.toISOString())},\n`;
        yield `  "generatedBy": ${JSON.stringify(context.generatedBy)},\n`;
        yield `  "filters": ${JSON.stringify(context.filterSummary)},\n`;
        yield `  "columns": ${JSON.stringify(
          context.columns.map((key) => ({ key, label: REPORT_COLUMNS[key].label })),
        )},\n`;
        yield '  "rows": [\n';

        let first = true;
        for await (const row of rows()) {
          const payload: Record<string, unknown> = {};
          for (const key of context.columns) {
            payload[key] = normalizeJsonValue(row[key]);
          }
          yield (first ? '    ' : ',\n    ') + JSON.stringify(payload);
          first = false;
        }

        yield '\n  ]\n}\n';
      })(),
    );
  }

  /**
   * Формирует PDF.
   *
   * Используется pdfmake, а не рендеринг HTML браузером: последний требует
   * образа с Chromium (плюс полтора гигабайта и отдельный процесс на каждый
   * отчёт) и постоянной возни со шрифтами для кириллицы. pdfmake собирает
   * документ детерминированно и на порядок дешевле по ресурсам.
   *
   * В отличие от XLSX и CSV документ собирается в памяти целиком — таково
   * устройство формата PDF, где таблица разбивается на страницы и размеры
   * колонок вычисляются по всему содержимому. Поэтому число строк для PDF
   * ограничено отдельно.
   */
  async renderPdf(context: RenderContext, rows: RowSupplier): Promise<Readable> {
    const pdfMake = await this.preparePdfMake();

    const body: unknown[][] = [
      context.columns.map((key) => ({
        text: REPORT_COLUMNS[key].label,
        bold: true,
        fillColor: '#E8EEF7',
      })),
    ];

    for await (const row of rows()) {
      body.push(
        context.columns.map((key) => ({
          text: formatCell(row[key], key),
          fontSize: 8,
        })),
      );
    }

    const landscape = context.columns.length > 4;
    const widths = distributeWidths(context.columns, landscape);

    const definition = {
      pageSize: 'A4',
      pageOrientation: landscape ? 'landscape' : 'portrait',
      pageMargins: [PAGE_MARGIN_X, 28, PAGE_MARGIN_X, 32],
      defaultStyle: { font: 'Roboto', fontSize: 9 },
      content: [
        { text: context.title, fontSize: 15, bold: true, margin: [0, 0, 0, 6] },
        ...context.filterSummary.map((line) => ({
          text: line,
          fontSize: 9,
          color: '#555555',
        })),
        {
          text:
            `Сформирован: ${formatDateTime(context.generatedAt)} · ` +
            `${context.generatedBy} · строк: ${context.rowCount}`,
          fontSize: 8,
          color: '#777777',
          margin: [0, 6, 0, 10],
        },
        {
          table: {
            headerRows: 1,
            widths,
            body,
          },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0.5,
            hLineColor: () => '#CCCCCC',
            vLineColor: () => '#CCCCCC',
          },
        },
      ],
      footer: (currentPage: number, pageCount: number) => ({
        text: `Страница ${currentPage} из ${pageCount}`,
        alignment: 'center',
        fontSize: 8,
        color: '#888888',
        margin: [0, 8, 0, 0],
      }),
    };

    const document = pdfMake.createPdf(definition);
    const source = await document.getStream();

    // Поток PDFDocument не завершается сам: документ финализируется только
    // вызовом end(), и до него событие 'end' не наступает — потребитель
    // ждёт вечно. Собственная реализация write() в pdfmake поступает так же:
    // сначала подключает приёмник, затем вызывает end().
    //
    // Данные перенаправляются в промежуточный поток, чтобы потребитель мог
    // подключиться позже: к моменту загрузки в хранилище документ уже
    // финализирован, и без буфера часть данных была бы потеряна.
    const output = new PassThrough();
    source.pipe(output);
    source.end();

    return output;
  }

  /**
   * Готовит pdfmake к работе.
   *
   * Настройка выполняется один раз на процесс: пакет экспортирует singleton,
   * и повторная установка шрифтов на каждый отчёт была бы лишней работой.
   */
  private async preparePdfMake(): Promise<PdfMakeInstance> {
    if (this.pdfMake) {
      return this.pdfMake;
    }

    const module = await import('pdfmake');
    const pdfMake = (module.default ?? module) as unknown as PdfMakeInstance;

    const { createRequire } = await import('node:module');
    const path = await import('node:path');
    const require = createRequire(import.meta.url);

    // Путь вычисляется от package.json пакета, а не задаётся жёстко:
    // при установке в другом месте (например, в образе) он не изменится.
    const packageRoot = path.dirname(require.resolve('pdfmake/package.json'));
    const fontsDir = path.join(packageRoot, 'fonts', 'Roboto');

    // Встроенные шрифты PDF кириллицу не содержат: без подключения
    // собственного шрифта текст выводится пустыми прямоугольниками.
    pdfMake.setFonts({
      Roboto: {
        normal: path.join(fontsDir, 'Roboto-Regular.ttf'),
        bold: path.join(fontsDir, 'Roboto-Medium.ttf'),
        italics: path.join(fontsDir, 'Roboto-Italic.ttf'),
        bolditalics: path.join(fontsDir, 'Roboto-MediumItalic.ttf'),
      },
    });

    // Доступ к файловой системе ограничен каталогом шрифтов.
    // Без явной политики pdfmake читает любые локальные пути, указанные
    // в описании документа, — а описание формируется из пользовательских
    // параметров отчёта, и открытый доступ к диску здесь недопустим.
    pdfMake.setLocalAccessPolicy((filePath: string) => filePath.startsWith(fontsDir));

    // Внешние адреса не загружаются вовсе: отчёт строится только
    // из данных системы, обращения в сеть при его формировании
    // означали бы либо ошибку, либо попытку вывести данные наружу.
    pdfMake.setUrlAccessPolicy(() => false);

    this.pdfMake = pdfMake;
    return pdfMake;
  }
}

/**
 * Минимальное описание используемого API pdfmake.
 *
 * Пакет @types/pdfmake описывает интерфейс версии 0.2, тогда как
 * установлена 0.3 с другим устройством: экспортируется настроенный
 * экземпляр, а не класс принтера.
 */
interface PdfMakeInstance {
  setFonts(fonts: Record<string, Record<string, string>>): void;
  setLocalAccessPolicy(callback: (path: string) => boolean): void;
  setUrlAccessPolicy(callback: (url: string) => boolean): void;
  createPdf(definition: unknown): {
    getStream(): Promise<Readable & { end(): void; pipe(dest: PassThrough): void }>;
  };
}

/** Ширина листа A4 в пунктах (1/72 дюйма). */
const A4_WIDTH_PT = 595.28;
const A4_HEIGHT_PT = 841.89;
/** Поля страницы слева и справа. */
const PAGE_MARGIN_X = 24;

/**
 * Распределяет ширину колонок по доступной ширине полосы.
 *
 * Значения width в описании колонок заданы в СИМВОЛАХ — такова единица
 * измерения ширины столбца в Excel. pdfmake же трактует число как ПУНКТЫ
 * (1/72 дюйма), и передача тех же значений напрямую даёт таблицу шириной
 * около трети страницы: пять колонок с суммой 150 занимают 150 пунктов
 * при доступных примерно 794.
 *
 * Поэтому значения используются как ВЕСА: сохраняются их соотношения,
 * а сумма приводится к ширине полосы. Наименование вуза остаётся вчетверо
 * шире признака просрочки, но таблица заполняет страницу целиком.
 */
function distributeWidths(columns: ReportColumnKey[], landscape: boolean): number[] {
  const pageWidth = landscape ? A4_HEIGHT_PT : A4_WIDTH_PT;
  const available = pageWidth - PAGE_MARGIN_X * 2;

  const weights = columns.map((key) => REPORT_COLUMNS[key].width);
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  if (total <= 0) {
    return columns.map(() => available / Math.max(1, columns.length));
  }

  // Небольшой запас: рамки ячеек занимают собственную ширину, и без него
  // последняя колонка вытесняется на следующую страницу.
  const usable = available - columns.length * 2;

  return weights.map((weight) => Math.floor((weight / total) * usable));
}

/** Приводит значение ячейки к строке для вывода. */
function formatCell(value: unknown, key: ReportColumnKey): string {
  if (value === null || value === undefined) {
    return '';
  }

  const type = REPORT_COLUMNS[key].type;

  if (type === 'boolean') {
    return value ? 'Да' : 'Нет';
  }

  if (value instanceof Date) {
    return type === 'date' ? formatDate(value) : formatDateTime(value);
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return String(value);
}

function normalizeJsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return Number(value);
  return value ?? null;
}

function formatDate(value: Date): string {
  return value.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' });
}

function formatDateTime(value: Date): string {
  return value.toLocaleString('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Символы, с которых Excel и LibreOffice начинают трактовать содержимое
 * ячейки как формулу. Табуляция и возврат каретки включены потому, что
 * ведущий пробельный символ отбрасывается при разборе, и `\t=1+1`
 * превращается в ту же формулу.
 */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Экранирует значение для CSV.
 *
 * Помимо разделителей нейтрализуются формулы. Это не теоретический риск:
 * значения приходят из импортируемых таблиц сторонних организаций и из
 * пользовательских комментариев, то есть полностью контролируются извне.
 * Ячейка вида `=cmd|'/c calc'!A1`, попав в выгрузку, выполнится на машине
 * того, кто откроет отчёт, — при этом сама система остаётся невредимой,
 * а страдает получатель файла.
 *
 * Значение не отбрасывается и не искажается: перед ним ставится апостроф,
 * который Excel понимает как «дальше текст» и в ячейке не показывает.
 */
function csvEscape(value: string): string {
  const neutralized = FORMULA_TRIGGERS.some((trigger) => value.startsWith(trigger))
    ? `'${value}`
    : value;

  if (
    neutralized.includes(';') ||
    neutralized.includes('"') ||
    neutralized.includes('\n') ||
    neutralized.includes('\r')
  ) {
    return `"${neutralized.replace(/"/g, '""')}"`;
  }

  return neutralized;
}

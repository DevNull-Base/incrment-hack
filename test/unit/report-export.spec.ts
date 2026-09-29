import { describe, expect, it } from 'vitest';
import { ReportRendererService, type RenderContext } from '../../src/modules/reporting/report-renderer.service.js';

/** Логгер-заглушка: рендеринг CSV к нему не обращается. */
const logger = {
  setContext: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  info: () => undefined,
  debug: () => undefined,
} as unknown as ConstructorParameters<typeof ReportRendererService>[0];

const context: RenderContext = {
  title: 'Взаимодействия с вузами',
  columns: ['universityName', 'ownerName'],
  filterSummary: [],
  generatedBy: 'Тестовый пользователь',
  generatedAt: new Date('2026-09-16T10:00:00Z'),
  rowCount: 1,
};

async function renderCsv(rows: Array<Record<string, unknown>>): Promise<string> {
  const renderer = new ReportRendererService(logger);
  const stream = renderer.renderCsv(context, async function* () {
    for (const row of rows) {
      yield row;
    }
  });

  const chunks: string[] = [];
  for await (const chunk of stream) {
    chunks.push(String(chunk));
  }

  return chunks.join('');
}

/**
 * Нейтрализация формул в CSV.
 *
 * Данные в отчёт попадают из импортируемых таблиц сторонних организаций
 * и из пользовательских комментариев, то есть полностью контролируются
 * извне. Ячейка, начинающаяся со знака равенства, выполняется в Excel
 * при открытии файла — страдает при этом не система, а получатель отчёта.
 */
describe('выгрузка CSV', () => {
  it('нейтрализует ячейку, начинающуюся со знака равенства', async () => {
    const csv = await renderCsv([{ universityName: '=1+1', ownerName: 'Иванов' }]);

    expect(csv).toContain("'=1+1");
    expect(csv).not.toMatch(/(^|;)=1\+1/m);
  });

  it.each(["=cmd|'/c calc'!A1", '+79001234567', '-2+3', '@SUM(A1)'])(
    'нейтрализует ячейку «%s»',
    async (value) => {
      const csv = await renderCsv([{ universityName: value, ownerName: 'Иванов' }]);
      const dataLine = csv.split('\r\n')[1] ?? '';

      expect(dataLine.startsWith("'")).toBe(true);
    },
  );

  it('не искажает обычные значения', async () => {
    const csv = await renderCsv([
      { universityName: 'МГТУ им. Н. Э. Баумана', ownerName: 'Петров П. П.' },
    ]);

    expect(csv).toContain('МГТУ им. Н. Э. Баумана');
    expect(csv).not.toContain("'МГТУ");
  });

  it('экранирует разделитель и кавычки', async () => {
    const csv = await renderCsv([
      { universityName: 'Вуз; с разделителем', ownerName: 'Он сказал "да"' },
    ]);

    expect(csv).toContain('"Вуз; с разделителем"');
    expect(csv).toContain('"Он сказал ""да"""');
  });
});

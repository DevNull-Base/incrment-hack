import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { Socket } from 'node:net';
import { AppConfig } from '../../config/configuration.js';

export type ScanVerdict =
  | { status: 'CLEAN' }
  | { status: 'INFECTED'; signature: string }
  | { status: 'SKIPPED'; reason: string }
  | { status: 'ERROR'; reason: string };

/** Максимальное время ожидания ответа сканера. */
const SCAN_TIMEOUT_MS = 30_000;

/**
 * Антивирусная проверка загружаемых файлов (группа мер АВЗ).
 *
 * Используется протокол clamd INSTREAM: содержимое передаётся сканеру
 * потоком, без записи во временный файл. Это важно по двум причинам —
 * заражённый файл не попадает на диск приложения, и не возникает гонки,
 * при которой файл успевают подменить между записью и проверкой.
 *
 * Собственная реализация протокола вместо готовой библиотеки выбрана
 * сознательно: протокол укладывается в несколько десятков строк, а доступные
 * пакеты добавляют зависимости ради того же самого.
 */
@Injectable()
export class AntivirusService {
  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AntivirusService.name);
  }

  get enabled(): boolean {
    return this.config.get('CLAMAV_ENABLED', { infer: true });
  }

  /**
   * Проверяет содержимое.
   *
   * При отключённом или недоступном сканере возвращается SKIPPED, а не CLEAN:
   * различие существенно. «Пропущено» честно фиксируется в карточке файла
   * и в журнале, тогда как «чисто» означало бы проведённую проверку,
   * которой не было.
   */
  async scan(content: Buffer): Promise<ScanVerdict> {
    if (!this.enabled) {
      return { status: 'SKIPPED', reason: 'Антивирусная проверка отключена настройкой' };
    }

    const host = this.config.get('CLAMAV_HOST', { infer: true });
    const port = this.config.get('CLAMAV_PORT', { infer: true });

    try {
      const response = await this.sendInstream(host, port, content);
      return this.interpret(response);
    } catch (error) {
      this.logger.error({ err: error, host, port }, 'Сбой обращения к антивирусному сканеру');
      return {
        status: 'ERROR',
        reason: error instanceof Error ? error.message : 'Неизвестная ошибка сканера',
      };
    }
  }

  /**
   * Передаёт содержимое командой INSTREAM.
   *
   * Формат: `zINSTREAM\0`, затем последовательность блоков вида
   * <4 байта длины, big-endian><данные>, завершаемая нулевой длиной.
   */
  private sendInstream(host: string, port: number, content: Buffer): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = new Socket();
      const chunks: Buffer[] = [];
      let settled = false;

      const finish = (error: Error | null, result?: string) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (error) reject(error);
        else resolve(result ?? '');
      };

      socket.setTimeout(SCAN_TIMEOUT_MS);
      socket.on('timeout', () => finish(new Error('Превышено время ожидания ответа сканера')));
      socket.on('error', (error) => finish(error));
      // Сокет без setEncoding отдаёт Buffer, но тип события допускает и строку.
      socket.on('data', (chunk: Buffer | string) => {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk);
      });
      socket.on('close', () => finish(null, Buffer.concat(chunks).toString('utf8').trim()));

      socket.connect(port, host, () => {
        socket.write('zINSTREAM\0');

        // Блоки по 64 КБ — размер, рекомендованный документацией clamd.
        const CHUNK_SIZE = 64 * 1024;
        for (let offset = 0; offset < content.length; offset += CHUNK_SIZE) {
          const slice = content.subarray(offset, offset + CHUNK_SIZE);
          const header = Buffer.alloc(4);
          header.writeUInt32BE(slice.length, 0);
          socket.write(header);
          socket.write(slice);
        }

        // Нулевая длина завершает передачу.
        const terminator = Buffer.alloc(4);
        terminator.writeUInt32BE(0, 0);
        socket.write(terminator);
      });
    });
  }

  /**
   * Разбирает ответ clamd вида `stream: OK` либо
   * `stream: Eicar-Test-Signature FOUND`.
   *
   * Ответ на команду с префиксом `z` завершается НУЛЕВЫМ БАЙТОМ, который
   * не удаляется методом trim(): тот убирает только пробельные символы.
   * Последствия неочевидны и проявляются далеко от источника — строка
   * с U+0000 отвергается PostgreSQL при записи («invalid byte sequence
   * for encoding UTF8»), и загрузка чистого файла падает с внутренней
   * ошибкой сервера. Поэтому управляющие символы отсекаются явно.
   */
  private interpret(rawResponse: string): ScanVerdict {
    const response = stripControlCharacters(rawResponse);

    if (response.endsWith('OK')) {
      return { status: 'CLEAN' };
    }

    if (response.includes('FOUND')) {
      const signature = response
        .replace(/^stream:/, '')
        .replace(/FOUND$/, '')
        .trim();
      return { status: 'INFECTED', signature: signature || 'неизвестная сигнатура' };
    }

    return { status: 'ERROR', reason: `Неожиданный ответ сканера: ${response.slice(0, 200)}` };
  }
}

/**
 * Удаляет управляющие символы, включая нулевой байт.
 *
 * PostgreSQL не хранит U+0000 в текстовых полях, поэтому любая строка,
 * пришедшая из внешнего источника, должна быть очищена до записи в базу.
 */
function stripControlCharacters(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.codePointAt(0) ?? 0;
      return code >= 32 || code === 10 || code === 13 || code === 9;
    })
    .join('')
    .trim();
}

import { Injectable, OnModuleInit } from '@nestjs/common';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { PinoLogger } from 'nestjs-pino';
import { AppException } from '../../common/errors/app-exception.js';
import { UserRole } from '../../generated/prisma/enums.js';
import { GuideDto, GuideSummaryDto } from './dto/guide.dto.js';

/**
 * Каталог с руководствами.
 *
 * Путь относительный, от рабочего каталога процесса: и при локальном запуске,
 * и в образе приложение стартует из корня проекта, поэтому одно значение
 * работает в обоих случаях.
 */
const GUIDES_DIR = path.join(process.cwd(), 'docs', 'guides');
const IMAGES_DIR = path.join(GUIDES_DIR, 'images');

/**
 * Имя иллюстрации: строчная латиница, цифры и дефис, только PNG. Всё
 * остальное отклоняется до обращения к диску — путь из запроса не может
 * выйти за пределы каталога иллюстраций.
 */
const IMAGE_NAME = /^[a-z0-9][a-z0-9-]{0,80}\.png$/;

interface LoadedGuide extends GuideDto {
  roles: UserRole[];
}

/**
 * Встроенная документация.
 *
 * Требование ТЗ: «вся документация должна быть встроена в платформу».
 * Поэтому руководства не ссылаются наружу и не лежат на отдельном сайте —
 * их отдаёт само приложение, и в закрытом контуре без доступа в интернет
 * они остаются доступны.
 *
 * Тексты хранятся файлами рядом с исходниками, а не в базе: документация
 * меняется вместе с системой, проходит тот же разбор изменений и попадает
 * в образ одной сборкой. База добавила бы ещё один путь доставки и ещё одно
 * место, где версия может разойтись с кодом.
 */
@Injectable()
export class GuidesService implements OnModuleInit {
  private guides: LoadedGuide[] = [];
  private readonly images = new Map<string, Buffer>();

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(GuidesService.name);
  }

  /**
   * Руководства читаются один раз при старте.
   *
   * Их немного, они не меняются во время работы процесса, а чтение с диска
   * на каждый запрос ради этого — лишняя задержка на пути пользователя.
   */
  async onModuleInit(): Promise<void> {
    try {
      this.guides = await this.load();
      this.logger.info({ count: this.guides.length }, 'Встроенная документация загружена');
    } catch (error: unknown) {
      // Отсутствие документации не должно мешать работе системы: это
      // справочный раздел, а не её основа.
      this.logger.warn({ err: error }, 'Не удалось загрузить встроенную документацию');
      this.guides = [];
    }
  }

  /** Разделы, доступные роли пользователя. */
  list(role: UserRole): GuideSummaryDto[] {
    return this.guides
      .filter((guide) => guide.roles.includes(role))
      .map(({ slug, title, description, order, updatedAt }) => ({
        slug,
        title,
        description,
        order,
        updatedAt,
      }));
  }

  /** Содержимое раздела. */
  get(slug: string, role: UserRole): GuideDto {
    const guide = this.guides.find((item) => item.slug === slug);

    // Раздел, недоступный роли, и несуществующий раздел отвечают одинаково:
    // по различию ответов нельзя было бы понять, что в системе есть
    // документация, предназначенная не вам.
    if (!guide || !guide.roles.includes(role)) {
      throw new AppException('NOT_FOUND', {
        detail: `Раздел документации «${slug}» не найден.`,
      });
    }

    return guide;
  }

  /**
   * Иллюстрация к руководству — снимок экрана на демонстрационных данных.
   * Файлы неизменны во время работы процесса, поэтому держатся в памяти
   * после первого чтения.
   */
  async image(name: string): Promise<Buffer> {
    if (!IMAGE_NAME.test(name)) {
      throw new AppException('NOT_FOUND', { detail: 'Иллюстрация не найдена.' });
    }

    const cached = this.images.get(name);
    if (cached) {
      return cached;
    }

    try {
      const content = await readFile(path.join(IMAGES_DIR, name));
      this.images.set(name, content);
      return content;
    } catch {
      throw new AppException('NOT_FOUND', { detail: 'Иллюстрация не найдена.' });
    }
  }

  private async load(): Promise<LoadedGuide[]> {
    const entries = await readdir(GUIDES_DIR);
    const guides: LoadedGuide[] = [];

    for (const entry of entries) {
      if (!entry.endsWith('.md')) {
        continue;
      }

      const file = path.join(GUIDES_DIR, entry);
      const [raw, info] = await Promise.all([readFile(file, 'utf8'), stat(file)]);
      const parsed = parseGuide(raw, entry);

      if (parsed) {
        guides.push({ ...parsed, updatedAt: info.mtime });
      }
    }

    return guides.sort((first, second) => first.order - second.order);
  }
}

/**
 * Разбирает заголовок файла и текст.
 *
 * Заголовок — минимальный YAML вида «ключ: значение»: полноценный разборщик
 * ради четырёх полей тянуть незачем, а состав полей задан здесь же и меняется
 * вместе с кодом.
 */
function parseGuide(raw: string, fileName: string): Omit<LoadedGuide, 'updatedAt'> | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);

  if (!match) {
    return null;
  }

  const [, header, body] = match;
  const meta = new Map<string, string>();

  for (const line of (header ?? '').split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator > 0) {
      meta.set(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
  }

  const slug = meta.get('slug') ?? fileName.replace(/\.md$/, '');
  const roles = (meta.get('roles') ?? '[USER, MANAGER, ADMIN]')
    .replace(/[[\]]/g, '')
    .split(',')
    .map((role) => role.trim())
    .filter((role): role is UserRole => role === 'USER' || role === 'MANAGER' || role === 'ADMIN');

  return {
    slug,
    title: meta.get('title') ?? slug,
    description: meta.get('description') ?? '',
    order: Number.parseInt(meta.get('order') ?? '99', 10),
    roles,
    content: (body ?? '').trim(),
  };
}

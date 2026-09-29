import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { PinoLogger } from 'nestjs-pino';
import { Readable } from 'node:stream';
import { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/errors/app-exception.js';

export type BucketKind = 'attachments' | 'reports';

export interface UploadResult {
  key: string;
  sizeBytes: number;
}

/**
 * Объектное хранилище (MinIO по протоколу S3).
 *
 * Используется AWS SDK v3, а не клиент minio: он S3-совместим, активно
 * поддерживается и предоставляет Upload из lib-storage — многочастную
 * загрузку прямо из потока. Последнее принципиально для отчётов: файл
 * уходит в хранилище по мере формирования, и расход памяти не зависит
 * от числа строк.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private client!: S3Client;
  private buckets!: Record<BucketKind, string>;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(StorageService.name);
  }

  onModuleInit(): void {
    this.client = new S3Client({
      endpoint: this.config.get('S3_ENDPOINT', { infer: true }),
      region: this.config.get('S3_REGION', { infer: true }),
      credentials: {
        accessKeyId: this.config.get('S3_ACCESS_KEY', { infer: true }),
        secretAccessKey: this.config.get('S3_SECRET_KEY', { infer: true }),
      },
      // MinIO адресует бакеты путём, а не поддоменом.
      forcePathStyle: this.config.get('S3_FORCE_PATH_STYLE', { infer: true }),
    });

    this.buckets = {
      attachments: this.config.get('S3_BUCKET_ATTACHMENTS', { infer: true }),
      reports: this.config.get('S3_BUCKET_REPORTS', { infer: true }),
    };
  }

  /** Проверка доступности хранилища для health-эндпоинта. */
  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.buckets.attachments }));
  }

  /**
   * Загружает поток в хранилище.
   *
   * Применяется многочастная загрузка: содержимое передаётся по мере
   * поступления, целиком в память не читается. Благодаря этому размер
   * файла ограничен только настройкой лимита, а не объёмом памяти процесса.
   */
  async upload(
    bucket: BucketKind,
    key: string,
    body: Readable,
    contentType: string,
  ): Promise<UploadResult> {
    try {
      // Шифрование на стороне хранилища включается настройкой. Значение
      // передаётся только когда оно задано: MinIO без настроенного KMS
      // отвергает запрос с заголовком шифрования, и загрузка падала бы
      // целиком вместо того, чтобы работать без него.
      const encryption = this.config.get('S3_SERVER_SIDE_ENCRYPTION', { infer: true });

      const upload = new Upload({
        client: this.client,
        params: {
          Bucket: this.buckets[bucket],
          Key: key,
          Body: body,
          ContentType: contentType,
          ...(encryption === 'none' ? {} : { ServerSideEncryption: encryption }),
        },
        // Части по 8 МБ: компромисс между числом запросов и расходом памяти
        // (одновременно в памяти находится queueSize * partSize).
        partSize: 8 * 1024 * 1024,
        queueSize: 2,
      });

      let sizeBytes = 0;
      upload.on('httpUploadProgress', (progress) => {
        sizeBytes = progress.loaded ?? sizeBytes;
      });

      await upload.done();

      return { key, sizeBytes };
    } catch (error) {
      this.logger.error({ err: error, bucket, key }, 'Не удалось загрузить объект в хранилище');
      throw new AppException('FILE_STORAGE_UNAVAILABLE', { cause: error });
    }
  }

  /** Возвращает поток содержимого объекта. */
  async download(bucket: BucketKind, key: string): Promise<{ stream: Readable; contentType?: string; size?: number }> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
      );

      if (!response.Body) {
        throw new AppException('NOT_FOUND', { detail: 'Объект в хранилище пуст.' });
      }

      return {
        stream: response.Body as Readable,
        contentType: response.ContentType,
        size: response.ContentLength,
      };
    } catch (error) {
      if (error instanceof AppException) throw error;

      const code = (error as { name?: string }).name;
      if (code === 'NoSuchKey' || code === 'NotFound') {
        throw new AppException('NOT_FOUND', { detail: 'Файл не найден в хранилище.', cause: error });
      }

      this.logger.error({ err: error, bucket, key }, 'Не удалось получить объект из хранилища');
      throw new AppException('FILE_STORAGE_UNAVAILABLE', { cause: error });
    }
  }

  async remove(bucket: BucketKind, key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.buckets[bucket], Key: key }));
    } catch (error) {
      this.logger.error({ err: error, bucket, key }, 'Не удалось удалить объект из хранилища');
      throw new AppException('FILE_STORAGE_UNAVAILABLE', { cause: error });
    }
  }

  /**
   * Ссылка с ограниченным сроком действия.
   *
   * Применяется только к отчётам, которые пользователь сформировал сам.
   * Для вложений ссылки не выдаются намеренно: они обходят проверку прав
   * и не оставляют следа в журнале, а доступ к приложенным документам
   * подлежит протоколированию.
   */
  async signedUrl(bucket: BucketKind, key: string, expiresInSeconds = 300): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.buckets[bucket], Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}

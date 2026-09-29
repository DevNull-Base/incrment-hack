import { describe, expect, it } from 'vitest';
import { validateConfig } from '../../src/config/configuration.js';

/**
 * Минимально достаточное окружение. Значения подобраны так, чтобы схема
 * проходила проверку, и в каждом тесте менялся ровно один параметр.
 */
const baseEnv = {
  DATABASE_URL: 'postgresql://crm:crm@localhost:5432/crm',
  REDIS_URL: 'redis://localhost:6379',
  KEYCLOAK_BASE_URL: 'http://keycloak:8080',
  KEYCLOAK_REALM: 'rtk-crm',
  KEYCLOAK_CLIENT_ID: 'crm-backend',
  S3_ENDPOINT: 'http://minio:9000',
  S3_ACCESS_KEY: 'key',
  S3_SECRET_KEY: 'secret',
};

const production = {
  ...baseEnv,
  NODE_ENV: 'production',
  CLAMAV_ENABLED: 'true',
  SWAGGER_PASSWORD: 'Sw@gger-2026-secret',
  CORS_ORIGINS: 'https://crm.example.ru',
  AUDIT_MASK_KEY: 'k3y-for-audit-masking-0123456789abcdef',
  KEYCLOAK_AUDIENCE: 'crm-backend',
};

/**
 * Перекрёстные проверки конфигурации.
 *
 * Принцип: опасное сочетание параметров роняет процесс при старте, а не
 * приводит к молча ослабленной защите. Ошибка конфигурации, обнаруженная
 * через месяц работы, означает месяц работы без соответствующей меры.
 */
describe('проверка конфигурации в production', () => {
  it('принимает корректное окружение', () => {
    expect(() => validateConfig(production)).not.toThrow();
  });

  it('требует проверку аудитории токена', () => {
    expect(() => validateConfig({ ...production, KEYCLOAK_AUDIENCE: '' })).toThrow(/KEYCLOAK_AUDIENCE/);
  });

  it('требует ключ маскирования ПДн в журнале аудита', () => {
    expect(() => validateConfig({ ...production, AUDIT_MASK_KEY: '' })).toThrow(/AUDIT_MASK_KEY/);
    expect(() => validateConfig({ ...production, AUDIT_MASK_KEY: 'short' })).toThrow(/AUDIT_MASK_KEY/);
    expect(() =>
      validateConfig({ ...production, AUDIT_MASK_KEY: 'ЗАМЕНИТЬ_НА_ДЛИННЫЙ_ПАРОЛЬ_0123456789abcdef' }),
    ).toThrow(/AUDIT_MASK_KEY/);
  });

  it('запрещает обход аутентификации', () => {
    expect(() => validateConfig({ ...production, AUTH_DEV_BYPASS: 'true' })).toThrow(
      /AUTH_DEV_BYPASS/,
    );
  });

  it('запрещает открытый список источников CORS', () => {
    expect(() => validateConfig({ ...production, CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });

  it('требует включённой антивирусной проверки', () => {
    expect(() => validateConfig({ ...production, CLAMAV_ENABLED: 'false' })).toThrow(
      /CLAMAV_ENABLED/,
    );
  });

  it('запрещает выдачу файлов без антивирусной проверки', () => {
    expect(() =>
      validateConfig({ ...production, ALLOW_UNSCANNED_DOWNLOAD: 'true' }),
    ).toThrow(/ALLOW_UNSCANNED_DOWNLOAD/);
  });

  it('не допускает публикации документации без пароля', () => {
    expect(() => validateConfig({ ...production, SWAGGER_PASSWORD: '' })).toThrow(
      /SWAGGER_PASSWORD/,
    );
  });

  it('разрешает не публиковать документацию вовсе', () => {
    expect(() =>
      validateConfig({ ...production, SWAGGER_PASSWORD: '', SWAGGER_ENABLED: 'false' }),
    ).not.toThrow();
  });

  it('запрещает отправку персональных данных во внешний ИИ-сервис', () => {
    expect(() =>
      validateConfig({
        ...production,
        LLM_ENABLED: 'true',
        LLM_API_KEY: 'sk-test',
        LLM_DEPERSONALIZE: 'false',
      }),
    ).toThrow(/LLM_DEPERSONALIZE/);
  });

  it('отвергает метку из образца настроек вместо секрета подписи', () => {
    // Текст метки лежит в публичном репозитории: подписать им событие
    // может кто угодно, так что это не секрет.
    expect(() =>
      validateConfig({
        ...production,
        INTEGRATION_WEBHOOK_SECRET: 'ЗАМЕНИТЬ_НА_ДЛИННУЮ_СЛУЧАЙНУЮ_СТРОКУ',
      }),
    ).toThrow(/INTEGRATION_WEBHOOK_SECRET/);
  });

  it('требует секрет подписи при боевом обмене', () => {
    expect(() => validateConfig({ ...production, INTEGRATION_MODE: 'live' })).toThrow(
      /INTEGRATION_WEBHOOK_SECRET/,
    );
    expect(() =>
      validateConfig({
        ...production,
        INTEGRATION_MODE: 'live',
        INTEGRATION_WEBHOOK_SECRET: 'kQ7vX2mN9pR4sT8wZ3yB6cD1fG5hJ0kL',
      }),
    ).not.toThrow();
  });
});

describe('проверка конфигурации в разработке', () => {
  it('допускает отключённый антивирус и открытую документацию', () => {
    // Ослабления действуют только вне production: иначе разработка
    // требовала бы поднимать ClamAV и придумывать пароли.
    expect(() => validateConfig({ ...baseEnv, NODE_ENV: 'development' })).not.toThrow();
  });

  it('отвергает некорректную строку подключения независимо от среды', () => {
    expect(() => validateConfig({ ...baseEnv, DATABASE_URL: 'не-адрес' })).toThrow(
      /DATABASE_URL/,
    );
  });
});

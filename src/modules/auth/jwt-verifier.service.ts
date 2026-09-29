import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { createRemoteJWKSet, jwtVerify, errors as joseErrors, type JWTPayload } from 'jose';
import { AppConfig } from '../../config/configuration.js';
import { AppException } from '../../common/errors/app-exception.js';
import { KeycloakClaims } from './authenticated-user.js';

/**
 * Проверка подписи и claims токенов Keycloak.
 *
 * Ключи забираются по JWKS и кэшируются библиотекой jose, которая сама
 * обновляет их при ротации. Обращение к Keycloak на каждый запрос не идёт —
 * иначе внешний сервис оказался бы на критическом пути каждого вызова API
 * и определял бы время отклика всей системы.
 */
@Injectable()
export class JwtVerifierService implements OnModuleInit {
  private jwks!: ReturnType<typeof createRemoteJWKSet>;
  private expectedIssuer!: string;
  private expectedAudience?: string;

  constructor(
    private readonly config: ConfigService<AppConfig, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(JwtVerifierService.name);
  }

  onModuleInit(): void {
    const internalBase = this.config.get('KEYCLOAK_BASE_URL', { infer: true });
    const publicBase = this.config.get('KEYCLOAK_PUBLIC_URL', { infer: true }) ?? internalBase;
    const realm = this.config.get('KEYCLOAK_REALM', { infer: true });

    // Ключи забираем по внутреннему адресу (доступен из контейнера),
    // а issuer сверяем с публичным — именно он записан в токене.
    const jwksUri = `${internalBase}/realms/${realm}/protocol/openid-connect/certs`;
    this.expectedIssuer = `${publicBase}/realms/${realm}`;

    const audience = this.config.get('KEYCLOAK_AUDIENCE', { infer: true });
    this.expectedAudience = audience.length > 0 ? audience : undefined;

    this.jwks = createRemoteJWKSet(new URL(jwksUri), {
      // Ключи кэшируются на 10 минут; при неизвестном kid выполняется
      // внеочередное обновление, но не чаще раза в 30 секунд —
      // это защищает Keycloak от шквала запросов с невалидными токенами.
      cacheMaxAge: 600_000,
      cooldownDuration: 30_000,
      timeoutDuration: 5_000,
    });

    this.logger.info(
      { jwksUri, expectedIssuer: this.expectedIssuer, expectedAudience: this.expectedAudience },
      'Проверка токенов настроена',
    );
  }

  /**
   * Проверяет токен и возвращает его claims.
   * Бросает AppException с кодом из реестра — фильтр исключений
   * превратит его в ответ RFC 9457.
   */
  async verify(token: string): Promise<KeycloakClaims> {
    try {
      const { payload } = await jwtVerify(token, this.jwks, {
        issuer: this.expectedIssuer,
        audience: this.expectedAudience,
        // Небольшой допуск компенсирует расхождение часов между узлами.
        clockTolerance: 5,
      });

      return this.toClaims(payload);
    } catch (error) {
      throw this.toAppException(error);
    }
  }

  private toClaims(payload: JWTPayload): KeycloakClaims {
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new AppException('TOKEN_INVALID', { detail: 'В токене отсутствует обязательный claim `sub`.' });
    }

    return payload as unknown as KeycloakClaims;
  }

  /** Разные причины отказа дают разные коды: клиент должен различать
   *  «токен просрочен, обнови» и «токен недействителен, переавторизуйся». */
  private toAppException(error: unknown): AppException {
    if (error instanceof AppException) {
      return error;
    }

    if (error instanceof joseErrors.JWTExpired) {
      return new AppException('TOKEN_EXPIRED', { cause: error });
    }

    if (
      error instanceof joseErrors.JWTClaimValidationFailed ||
      error instanceof joseErrors.JWSSignatureVerificationFailed ||
      error instanceof joseErrors.JWSInvalid ||
      error instanceof joseErrors.JWTInvalid ||
      // Ключа с таким kid у сервера нет либо алгоритм не тот — токен
      // выпущен не нашим сервером аутентификации.
      error instanceof joseErrors.JWKSNoMatchingKey ||
      error instanceof joseErrors.JWKSMultipleMatchingKeys ||
      error instanceof joseErrors.JOSEAlgNotAllowed ||
      error instanceof joseErrors.JOSENotSupported
    ) {
      return new AppException('TOKEN_INVALID', {
        detail: 'Подпись, issuer или audience токена не прошли проверку.',
        cause: error,
      });
    }

    // Недоступность Keycloak при загрузке JWKS — инфраструктурный сбой,
    // а не проблема токена. Прежде он возвращался как 401 «токен
    // недействителен», и интерфейс, как положено при 401, выбрасывал
    // пользователя на вход — во время перезапуска Keycloak это разлогинивало
    // всех разом, причём на недоступную страницу входа. 503 говорит клиенту
    // «повторите позже», не трогая сеанс.
    this.logger.error({ err: error }, 'Не удалось проверить токен: сервер аутентификации недоступен');
    return new AppException('AUTH_PROVIDER_UNAVAILABLE', { cause: error });
  }
}

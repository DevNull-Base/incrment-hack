import { UserRole } from '../../generated/prisma/enums.js';

/**
 * Пользователь, прошедший аутентификацию.
 *
 * Объект собирается из claims токена Keycloak и локальной записи AppUser,
 * после чего помещается в запрос. Все проверки прав работают именно с ним,
 * а не с сырым токеном.
 */
export interface AuthenticatedUser {
  /** Внутренний идентификатор (AppUser.id). Используется во всех связях БД. */
  id: string;
  /** `sub` из токена — связь с учётной записью Keycloak. */
  keycloakSub: string;
  email: string;
  displayName: string;
  role: UserRole;
  /** Руководитель пользователя — определяет иерархию видимости данных. */
  managerId: string | null;
}

/** Набор claims токена Keycloak, которые использует система. */
export interface KeycloakClaims {
  sub: string;
  email?: string;
  /** Подтвердил ли пользователь адрес почты в Keycloak. */
  email_verified?: boolean;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
  realm_access?: { roles?: string[] };
  exp?: number;
  iat?: number;
}

/**
 * Определяет прикладную роль по ролям realm.
 *
 * Роли не складываются, а упорядочены по старшинству: при наличии нескольких
 * назначается наиболее привилегированная. Иначе пользователь, которому
 * добавили роль ADMIN, но не сняли USER, получил бы права рядового менеджера.
 */
export function resolveRole(realmRoles: readonly string[] | undefined): UserRole | null {
  const roles = new Set((realmRoles ?? []).map((role) => role.toUpperCase()));

  if (roles.has('ADMIN')) return 'ADMIN';
  if (roles.has('MANAGER')) return 'MANAGER';
  if (roles.has('USER')) return 'USER';

  // Роли CRM нет — доступа нет. Прежде такая учётная запись получала USER:
  // вход открывался любому пользователю realm, заведённому для другой
  // системы, а снятие роли в Keycloak доступ не отзывало.
  return null;
}

/** Формирует отображаемое имя из доступных claims. */
export function resolveDisplayName(claims: KeycloakClaims): string {
  const fromParts = [claims.family_name, claims.given_name].filter(Boolean).join(' ').trim();
  return fromParts || claims.name || claims.preferred_username || claims.email || claims.sub;
}

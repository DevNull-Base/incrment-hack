import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../generated/prisma/enums.js';

export const ROLES_KEY = 'requiredRoles';

/**
 * Ограничивает доступ к маршруту перечисленными ролями.
 *
 * @example
 * // Переназначать ответственных может только руководитель или администратор
 * @Roles('MANAGER', 'ADMIN')
 * reassign() { ... }
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

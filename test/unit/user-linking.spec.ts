import { describe, expect, it, vi } from 'vitest';
import { UserProvisioningService } from '../../src/modules/auth/user-provisioning.service.js';

type Args = ConstructorParameters<typeof UserProvisioningService>;

/**
 * Привязка учётной записи Keycloak к сотруднику, заведённому в CRM заранее.
 *
 * Почту в Keycloak пользователь может сменить сам, поэтому по почте
 * привязывается только подтверждённый адрес: иначе новая учётная запись
 * с чужим адресом занимала бы запись CRM вместе с её ролью и заявками.
 */
function service(existingByEmail: { id: string; roleManagedLocally: boolean } | null) {
  const update = vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'crm-user',
    keycloakSub: data.keycloakSub ?? 'old-sub',
    email: 'admin@example.ru',
    displayName: 'Администратор',
    role: 'ADMIN',
    managerId: null,
    isActive: true,
  }));

  const prisma = {
    appUser: {
      findUnique: vi.fn(async ({ where }: { where: { keycloakSub?: string; email?: string } }) =>
        where.email ? existingByEmail : null,
      ),
      update,
      create: vi.fn(),
    },
  };

  const redis = { get: async () => null, set: async () => 'OK', del: async () => 1 };
  const logger = { setContext: () => undefined, warn: () => undefined, info: () => undefined, error: () => undefined };
  const audit = { record: async () => undefined };
  const config = { get: () => 60 };

  const instance = new UserProvisioningService(
    prisma as unknown as Args[0],
    config as unknown as Args[1],
    redis as unknown as Args[2],
    audit as unknown as Args[3],
    logger as unknown as Args[4],
  );

  return { instance, update };
}

const claims = (emailVerified: boolean | undefined, roles: string[] = ['USER']) => ({
  sub: 'new-keycloak-sub',
  email: 'admin@example.ru',
  email_verified: emailVerified,
  preferred_username: 'intruder',
  realm_access: { roles },
});

describe('привязка учётной записи по почте', () => {
  it('подтверждённый адрес привязывается к заведённому сотруднику', async () => {
    const { instance, update } = service({ id: 'crm-user', roleManagedLocally: true });

    await expect(instance.resolve(claims(true))).resolves.toMatchObject({ id: 'crm-user' });
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ keycloakSub: 'new-keycloak-sub' }) }));
  });

  it.each([false, undefined])('неподтверждённый адрес (%s) чужую запись не занимает', async (verified) => {
    const { instance, update } = service({ id: 'crm-user', roleManagedLocally: true });

    await expect(instance.resolve(claims(verified))).rejects.toMatchObject({ definition: { code: 'CRM-ACL-0001' } });
    expect(update).not.toHaveBeenCalled();
  });
});

describe('роль CRM в токене', () => {
  it('без роли CRM новая учётная запись не заводится', async () => {
    const { instance, update } = service(null);

    await expect(instance.resolve(claims(true, ['offline_access', 'default-roles-rtk-crm']))).rejects.toMatchObject({
      definition: { code: 'CRM-AUT-0006' },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('снятие роли в Keycloak отзывает доступ', async () => {
    const { instance } = service({ id: 'crm-user', roleManagedLocally: false });

    await expect(instance.resolve(claims(true, []))).rejects.toMatchObject({ definition: { code: 'CRM-AUT-0006' } });
  });

  it('роль, назначенная в CRM, действует и без роли в токене', async () => {
    const { instance } = service({ id: 'crm-user', roleManagedLocally: true });

    await expect(instance.resolve(claims(true, []))).resolves.toMatchObject({ id: 'crm-user' });
  });
});

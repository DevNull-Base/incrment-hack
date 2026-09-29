import type { Prisma } from '../../generated/prisma/client.js';
import { organizationKey, titleKey } from '../../common/utils/contact-normalization.js';

type CatalogReader = Pick<Prisma.TransactionClient, 'vendor' | 'softwareProduct'>;

/**
 * Вендор по названию в любой записи.
 *
 * В файлах заказчика одна компания записана по-разному: «ПАО «Ростелеком»»
 * в каталоге вендоров и «Ростелеком» в таблице взаимодействий. Сравнение
 * идёт без организационно-правовой формы, кавычек и регистра — иначе
 * каждая загрузка заводила бы компании-двойники.
 *
 * Каталог вендоров мал (десятки записей), поэтому он читается целиком,
 * а не ищется запросом по нормализованному полю.
 */
export async function findVendorByName(db: CatalogReader, name: string): Promise<{ id: string; name: string } | null> {
  const key = organizationKey(name);

  if (key.length === 0) {
    return null;
  }

  const vendors = await db.vendor.findMany({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } });
  return vendors.find((vendor) => organizationKey(vendor.name) === key) ?? null;
}

/** Продукт вендора по названию без учёта регистра, кавычек и знаков препинания. */
export async function findProductByName(
  db: CatalogReader,
  vendorId: string | null,
  name: string,
): Promise<{ id: string; name: string } | null> {
  const key = titleKey(name);

  if (key.length === 0) {
    return null;
  }

  const products = await db.softwareProduct.findMany({
    where: vendorId ? { vendorId } : {},
    select: { id: true, name: true },
    orderBy: { createdAt: 'asc' },
  });

  return products.find((product) => titleKey(product.name) === key) ?? null;
}

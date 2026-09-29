import { SetMetadata } from '@nestjs/common';

export const PERSONAL_DATA_KEY = 'touchesPersonalData';

/**
 * Помечает маршрут, выдающий персональные данные.
 *
 * Два следствия, оба обязательные:
 *   • обращение фиксируется в журнале действием VIEW_PERSONAL_DATA —
 *     оператор обязан знать, кто и когда получал доступ к ПДн;
 *   • ответ помечается `Cache-Control: no-store`, чтобы персональные данные
 *     не оседали в кэше браузера и промежуточных узлов.
 *
 * Пометка проставляется декларативно, а не вызовом журналирования внутри
 * метода: так она видна при просмотре контроллера, и добавление нового
 * метода, выдающего ПДн, сводится к одной строке, а не к правке сервиса.
 *
 * @param entityType тип сущности для записи в журнал (по умолчанию Person)
 *
 * @example
 * @PersonalData('Person')
 * @Get('persons/:id')
 * findOne() { ... }
 */
export const PersonalData = (entityType = 'Person') =>
  SetMetadata(PERSONAL_DATA_KEY, entityType);

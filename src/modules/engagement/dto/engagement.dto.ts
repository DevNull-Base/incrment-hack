import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ToBoolean } from '../../../common/dto/query-transforms.js';
import { PageQueryDto } from '../../../common/dto/pagination.dto.js';
import {
  CounterpartyType,
  EngagementSegment,
  InterestLevel,
} from '../../../generated/prisma/enums.js';

const SEGMENT_VALUES: EngagementSegment[] = ['B2B', 'B2C'];
const COUNTERPARTY_TYPE_VALUES: CounterpartyType[] = ['UNIVERSITY', 'PERSON', 'COMPANY'];
export const INTEREST_LEVEL_VALUES: InterestLevel[] = ['LOW', 'MEDIUM', 'HIGH'];

/** Значение отбора «оценки ещё нет» — в перечислении его нет, в базе это NULL. */
export const INTEREST_UNSET = 'UNSET';
export type InterestFilterValue = InterestLevel | typeof INTEREST_UNSET;
const INTEREST_FILTER_VALUES: InterestFilterValue[] = [...INTEREST_LEVEL_VALUES, INTEREST_UNSET];

export type { CounterpartyType, EngagementSegment, InterestLevel };

/**
 * Приводит параметр запроса к списку.
 *
 * Клиенты передают набор значений по-разному: повтором параметра
 * (?level=LOW&level=HIGH) либо через запятую (?level=LOW,HIGH). Поддерживаются
 * оба способа — отказ на одном из них выглядел бы для фронтенда случайным.
 */
export const toList = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const items = Array.isArray(value) ? value : [value];

  return items
    .flatMap((item) => String(item).split(','))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
};

export class EngagementQueryDto extends PageQueryDto {
  @ApiPropertyOptional({
    description: 'Фильтр по сегменту: работа с вузами либо прямые продажи',
    enum: SEGMENT_VALUES,
  })
  @IsOptional()
  @IsEnum(SEGMENT_VALUES)
  segment?: EngagementSegment;

  @ApiPropertyOptional({ description: 'Фильтр по вузу', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  universityId?: string;

  @ApiPropertyOptional({ description: 'Фильтр по ИТ-направлению', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  directionId?: string;

  @ApiPropertyOptional({ description: 'Фильтр по ИТ-продукту', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'Фильтр по ИТ-программе', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  programId?: string;

  @ApiPropertyOptional({ description: 'Фильтр по ответственному', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Фильтр по текущему статусу', example: 'SIGNING' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  stateKey?: string;

  @ApiPropertyOptional({ description: 'Начало периода (по дате создания), ISO 8601' })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата в формате ISO 8601' })
  periodFrom?: string;

  @ApiPropertyOptional({ description: 'Конец периода (по дате создания), ISO 8601' })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата в формате ISO 8601' })
  periodTo?: string;

  @ApiPropertyOptional({
    description:
      'Изменены не раньше, ISO 8601. Вместе с отбором по ответственному даёт ' +
      '«мои заявки, в которых что-то происходило за последние две недели».',
  })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата в формате ISO 8601' })
  updatedFrom?: string;

  @ApiPropertyOptional({ description: 'Изменены не позже, ISO 8601' })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата в формате ISO 8601' })
  updatedTo?: string;

  @ApiPropertyOptional({
    description:
      'Отбор по заинтересованности. Несколько значений — повтором параметра или ' +
      'через запятую. UNSET — заявки, где оценки ещё нет.',
    type: [String],
    enum: INTEREST_FILTER_VALUES,
    example: ['HIGH', 'MEDIUM'],
  })
  @IsOptional()
  @Transform(toList)
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(INTEREST_FILTER_VALUES, {
    each: true,
    message: 'Допустимые значения: LOW, MEDIUM, HIGH, UNSET',
  })
  interestLevels?: InterestFilterValue[];

  @ApiPropertyOptional({ description: 'Включать архивные записи', default: false })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeArchived?: boolean = false;

  @ApiPropertyOptional({
    description:
      'Поле сортировки. interestLevel упорядочивает LOW → MEDIUM → HIGH; ' +
      'заявки без оценки всегда в конце.',
    enum: ['updatedAt', 'createdAt', 'universityName', 'interestLevel'],
    default: 'updatedAt',
  })
  @IsOptional()
  @IsIn(['updatedAt', 'createdAt', 'universityName', 'interestLevel'], {
    message: 'Допустимые значения: updatedAt, createdAt, universityName, interestLevel',
  })
  sortBy?: 'updatedAt' | 'createdAt' | 'universityName' | 'interestLevel' = 'updatedAt';
}

/**
 * Правка карточки.
 *
 * Передаются только изменяемые поля. null очищает значение, отсутствие поля
 * оставляет его прежним. Статус здесь не меняется — для этого есть переход
 * по процессу с его условиями, а ответственный меняется переназначением.
 */
export class UpdateEngagementDto {
  @ApiPropertyOptional({ description: 'Название карточки', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string | null;

  @ApiPropertyOptional({
    description: 'ИТ-программа. Должна относиться к направлению заявки.',
    format: 'uuid',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  programId?: string | null;

  @ApiPropertyOptional({
    description:
      'Заинтересованность контрагента в программе: LOW, MEDIUM, HIGH. ' +
      'null снимает оценку вместе с обоснованием.',
    enum: INTEREST_LEVEL_VALUES,
    nullable: true,
  })
  @IsOptional()
  @IsEnum(INTEREST_LEVEL_VALUES, { message: 'Допустимые значения: LOW, MEDIUM, HIGH' })
  interestLevel?: InterestLevel | null;

  @ApiPropertyOptional({
    description: 'Короткое обоснование оценки: почему вуз заинтересован или нет',
    nullable: true,
    example: 'Кафедра готова включить курс в весенний семестр',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  interestComment?: string | null;
}

/** Разрез рейтинга заинтересованности. */
export const INTEREST_GROUP_VALUES = ['direction', 'product', 'program', 'university'] as const;
export type InterestGroupBy = (typeof INTEREST_GROUP_VALUES)[number];

export class InterestSummaryQueryDto {
  @ApiPropertyOptional({
    description: 'Разрез: ИТ-направление, ИТ-продукт, ИТ-программа или вуз',
    enum: INTEREST_GROUP_VALUES,
    default: 'direction',
  })
  @IsOptional()
  @IsIn([...INTEREST_GROUP_VALUES], {
    message: 'Допустимые значения: direction, product, program, university',
  })
  groupBy: InterestGroupBy = 'direction';

  @ApiPropertyOptional({ description: 'Сегмент', enum: SEGMENT_VALUES })
  @IsOptional()
  @IsEnum(SEGMENT_VALUES)
  segment?: EngagementSegment;

  @ApiPropertyOptional({ description: 'Начало периода (по дате создания заявки), ISO 8601' })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата в формате ISO 8601' })
  periodFrom?: string;

  @ApiPropertyOptional({ description: 'Конец периода (по дате создания заявки), ISO 8601' })
  @IsOptional()
  @IsDateString({}, { message: 'Ожидается дата в формате ISO 8601' })
  periodTo?: string;

  @ApiPropertyOptional({ description: 'Включать архивные заявки', default: false })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeArchived?: boolean = false;
}

export class InterestSummaryRowDto {
  @ApiProperty({
    description: 'Идентификатор направления, продукта, программы или вуза; null — не указано',
    format: 'uuid',
    nullable: true,
  })
  id!: string | null;

  @ApiProperty({ example: 'DevOps' })
  name!: string;

  @ApiProperty({ description: 'Всего заявок в группе' })
  total!: number;

  @ApiProperty({ description: 'Из них с оценкой' })
  rated!: number;

  @ApiProperty()
  high!: number;

  @ApiProperty()
  medium!: number;

  @ApiProperty()
  low!: number;

  @ApiProperty({ description: 'Без оценки' })
  unrated!: number;

  @ApiProperty({
    description:
      'Индекс заинтересованности, 0–100: средняя оценка по заявкам с оценкой, ' +
      'где HIGH = 100, MEDIUM = 50, LOW = 0. null — оценок в группе нет.',
    nullable: true,
    example: 72,
  })
  score!: number | null;
}

export class InterestSummaryDto {
  @ApiProperty({ enum: INTEREST_GROUP_VALUES })
  groupBy!: InterestGroupBy;

  @ApiProperty({
    type: [InterestSummaryRowDto],
    description: 'Группы по убыванию индекса; группы без оценок — в конце',
  })
  rows!: InterestSummaryRowDto[];
}

export class CreateEngagementDto {
  @ApiPropertyOptional({
    description:
      'Сегмент взаимодействия. B2B — работа с вузом, B2C — прямая работа ' +
      'с обучающимся или сторонней организацией. По умолчанию B2B.',
    enum: SEGMENT_VALUES,
    default: 'B2B',
  })
  @IsOptional()
  @IsEnum(SEGMENT_VALUES)
  segment?: EngagementSegment;

  @ApiPropertyOptional({
    description: 'Вуз. Обязателен для сегмента B2B, для B2C не указывается.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  universityId?: string;

  @ApiPropertyOptional({
    description: 'Тип контрагента для B2C: физическое или юридическое лицо',
    enum: COUNTERPARTY_TYPE_VALUES,
  })
  @IsOptional()
  @IsEnum(COUNTERPARTY_TYPE_VALUES)
  counterpartyType?: CounterpartyType;

  @ApiPropertyOptional({
    description: 'Наименование контрагента. Обязательно для сегмента B2C.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  counterpartyName?: string;

  @ApiPropertyOptional({
    description: 'Контактное лицо контрагента (запись каталога персон)',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  counterpartyContactId?: string;

  @ApiProperty({ description: 'ИТ-направление', format: 'uuid' })
  @IsUUID()
  directionId!: string;

  @ApiPropertyOptional({ description: 'ИТ-продукт', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  productId?: string;

  @ApiPropertyOptional({ description: 'ИТ-программа', format: 'uuid' })
  @IsOptional()
  @IsUUID()
  programId?: string;

  @ApiPropertyOptional({
    description: 'Ответственный. По умолчанию — создающий пользователь.',
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID()
  ownerId?: string;

  @ApiPropertyOptional({ description: 'Краткое название карточки' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  title?: string;
}

export class ReassignEngagementDto {
  @ApiProperty({ description: 'Новый ответственный', format: 'uuid' })
  @IsUUID()
  ownerId!: string;

  @ApiPropertyOptional({ description: 'Причина переназначения' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class EngagementListItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Сегмент взаимодействия', enum: SEGMENT_VALUES })
  segment!: EngagementSegment;

  @ApiProperty({ description: 'Тип контрагента', enum: COUNTERPARTY_TYPE_VALUES })
  counterpartyType!: CounterpartyType;

  /**
   * Готовое к показу имя контрагента: вуз для B2B, наименование лица для B2C.
   * Отдаётся отдельным полем, чтобы список заявок выводился одной колонкой
   * независимо от сегмента, а не разбирался условиями на стороне клиента.
   */
  @ApiProperty({ description: 'Контрагент: вуз либо лицо' })
  counterpartyName!: string;

  @ApiProperty({ description: 'Наименование вуза, null для B2C', nullable: true })
  universityName!: string | null;

  @ApiProperty({ description: 'Сокращённое наименование вуза', nullable: true })
  universityShortName!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  universityId!: string | null;

  @ApiProperty({ description: 'ИТ-направление' })
  directionName!: string;

  @ApiProperty({ format: 'uuid' })
  directionId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  productId!: string | null;

  @ApiProperty({ description: 'ИТ-продукт', nullable: true })
  productName!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  programId!: string | null;

  @ApiProperty({ description: 'ИТ-программа', nullable: true })
  programName!: string | null;

  @ApiProperty({
    description: 'Внешняя система, из которой пришла заявка (источник интеграции); null — заведена в CRM',
    nullable: true,
  })
  externalSource!: string | null;

  @ApiProperty({ description: 'Ответственный' })
  ownerName!: string;

  @ApiProperty({ format: 'uuid' })
  ownerId!: string;

  @ApiProperty({ description: 'Ключ текущего статуса', example: 'SIGNING' })
  currentStateKey!: string;

  @ApiProperty({ description: 'Название текущего статуса', example: 'Подписание документов' })
  currentStateLabel!: string;

  @ApiProperty({ description: 'Срок по нормативу текущего этапа', nullable: true })
  slaDueAt!: Date | null;

  @ApiProperty({
    description:
      'Заинтересованность контрагента: LOW, MEDIUM, HIGH; null — оценки нет. ' +
      'По ней карточка в списке получает цветовую метку.',
    enum: INTEREST_LEVEL_VALUES,
    nullable: true,
  })
  interestLevel!: InterestLevel | null;

  @ApiProperty({ description: 'Просрочен ли норматив текущего этапа' })
  isOverdue!: boolean;

  @ApiProperty({
    description:
      'Находится ли в архиве. Нужен в строке списка: с includeArchived=true интерфейс ' +
      'получает активные и архивные заявки одним списком, а не двумя запросами.',
  })
  isArchived!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;
}

/** Доступный переход из текущего состояния. */
export class AvailableTransitionDto {
  @ApiProperty({ description: 'Ключ целевого состояния', example: 'MATERIALS_TRANSFER' })
  toStateKey!: string;

  @ApiProperty({ description: 'Название целевого состояния' })
  toStateLabel!: string;

  @ApiProperty({ description: 'Подпись действия', example: 'Документы подписаны' })
  label!: string;

  @ApiProperty({ description: 'Обязателен ли комментарий при переходе' })
  requiresComment!: boolean;

  @ApiProperty({ description: 'Требуется ли вложение перед выходом из текущего состояния' })
  requiresAttachment!: boolean;

  @ApiProperty({
    description: 'Доступен ли переход текущему пользователю с учётом его роли',
  })
  allowed!: boolean;

  @ApiProperty({
    description: 'Причина недоступности перехода; null, если переход доступен',
    nullable: true,
  })
  blockedReason!: string | null;
}

export class TransitionHistoryItemDto {
  @ApiProperty({ description: 'Идентификатор записи журнала' })
  id!: string;

  @ApiProperty({ description: 'Статус до перехода', nullable: true })
  fromStateLabel!: string | null;

  @ApiProperty({ description: 'Статус после перехода' })
  toStateLabel!: string;

  @ApiProperty({ description: 'Кто выполнил переход' })
  actorName!: string;

  @ApiProperty({ description: 'Комментарий', nullable: true })
  comment!: string | null;

  @ApiProperty()
  createdAt!: Date;
}

/** Этап процесса в карточке — с числом заметок и файлов на нём. */
export class StageSummaryDto {
  @ApiProperty({ example: 'SIGNING' })
  key!: string;

  @ApiProperty({ example: 'Подписание документов' })
  label!: string;

  @ApiProperty({ description: 'Заявка стоит на этом этапе сейчас' })
  isCurrent!: boolean;

  @ApiProperty()
  isInitial!: boolean;

  @ApiProperty()
  isFinal!: boolean;

  @ApiProperty({
    description:
      'Этапа нет в действующей схеме: его удалили, а заметки или файлы на нём ' +
      'сохранились. Такие этапы идут в конце списка.',
  })
  isRemoved!: boolean;

  @ApiProperty({ description: 'Выйти с этапа можно только с приложенным к нему файлом' })
  requiresAttachment!: boolean;

  @ApiProperty({ description: 'Норматив этапа, дней', nullable: true })
  slaDays!: number | null;

  @ApiProperty({ description: 'Заметок на этапе' })
  noteCount!: number;

  @ApiProperty({ description: 'Файлов на этапе' })
  attachmentCount!: number;
}

export class EngagementDetailDto extends EngagementListItemDto {
  @ApiProperty({ description: 'Название карточки', nullable: true })
  title!: string | null;

  @ApiProperty({ description: 'Версия записи для контроля конкурентных изменений' })
  version!: number;

  @ApiProperty({ description: 'Переходы, доступные из текущего статуса', type: [AvailableTransitionDto] })
  availableTransitions!: AvailableTransitionDto[];

  @ApiProperty({ description: 'История переходов, новые сверху', type: [TransitionHistoryItemDto] })
  history!: TransitionHistoryItemDto[];

  @ApiProperty({ description: 'Число приложенных файлов' })
  attachmentCount!: number;

  @ApiProperty({ description: 'Число заметок — к заявке и ко всем её этапам' })
  noteCount!: number;

  @ApiProperty({
    description:
      'Этапы процесса по порядку схемы с числом заметок и файлов на каждом. ' +
      'По этому списку строится путь заявки со значками.',
    type: [StageSummaryDto],
  })
  stages!: StageSummaryDto[];

  @ApiProperty({ description: 'Обоснование оценки заинтересованности', nullable: true })
  interestComment!: string | null;

  @ApiProperty({ description: 'Когда оценку ставили последний раз', nullable: true })
  interestUpdatedAt!: Date | null;

  @ApiProperty({ description: 'Кто поставил оценку', nullable: true })
  interestUpdatedByName!: string | null;

  @ApiProperty({
    description:
      'Прямая продажа: когда подтверждена оплата (сайтом либо загрузкой оплат). ' +
      'Подтверждённая оплата заменяет документ на этапе «Договор и оплата».',
    nullable: true,
  })
  paymentConfirmedAt!: Date | null;

  @ApiProperty({ description: 'Номер оплаченного заказа на сайте', nullable: true, example: 'ORD-20260917143022-K7QX2M' })
  paymentReference!: string | null;

  @ApiProperty({ description: 'Поток обучения', nullable: true, example: '3' })
  studyStream!: string | null;

  @ApiProperty({ description: 'Когда слушатель выгружен для загрузки в LMS', nullable: true })
  lmsExportedAt!: Date | null;

  @ApiProperty({ description: 'Когда заявка отправлена в архив', nullable: true })
  archivedAt!: Date | null;

  @ApiProperty({ description: 'Кто отправил заявку в архив', nullable: true })
  archivedByName!: string | null;

  @ApiProperty({ description: 'Почему заявка отправлена в архив', nullable: true })
  archiveReason!: string | null;
}

export class ArchiveEngagementDto {
  @ApiPropertyOptional({
    description:
      'Почему заявка уходит в архив. Обязательно для незавершённой заявки — её отправляет ' +
      'в архив руководитель или администратор.',
    example: 'Вуз свернул направление, работа прекращена',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}

export class PerformTransitionDto {
  @ApiProperty({ description: 'Ключ целевого состояния', example: 'SIGNING' })
  @IsString()
  @MaxLength(64)
  toStateKey!: string;

  @ApiPropertyOptional({
    description: 'Комментарий к переходу. Обязателен, если этого требует правило перехода.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  comment?: string;
}

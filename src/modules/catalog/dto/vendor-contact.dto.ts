import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ToBoolean } from '../../../common/dto/query-transforms.js';
import type { ContactChannelValue } from '../../../common/utils/contact-normalization.js';

export const CONTACT_CHANNEL_VALUES: ContactChannelValue[] = ['EMAIL', 'PHONE', 'TELEGRAM', 'MAX'];

export class CreateVendorContactDto {
  @ApiProperty({ example: 'Иванов Иван Иванович' })
  @IsString()
  @MinLength(2, { message: 'Укажите ФИО' })
  @MaxLength(300)
  fullName!: string;

  @ApiPropertyOptional({
    description: 'Телефон в любом формате — будет приведён к +7XXXXXXXXXX',
    example: '+7 (900) 111-22-33',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: 'ivanov.ii@example.ru' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  email?: string;

  @ApiPropertyOptional({ example: 'Руководитель направления по работе с вузами' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  position?: string;

  @ApiPropertyOptional({
    description: 'Предпочтительные способы связи по порядку',
    type: [String],
    enum: CONTACT_CHANNEL_VALUES,
    example: ['EMAIL', 'TELEGRAM'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(CONTACT_CHANNEL_VALUES, { each: true, message: 'Допустимые значения: EMAIL, PHONE, TELEGRAM, MAX' })
  channels?: ContactChannelValue[];

  @ApiPropertyOptional({
    description: 'Продукты вендора, по которым обращаться к человеку; пусто — по всем',
    type: [String],
    example: ['RT.DataLake'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  products?: string[];

  @ApiPropertyOptional({ description: 'Основной контакт вендора', default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/** Правка контакта. null очищает необязательное поле. */
export class UpdateVendorContactDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(300)
  fullName?: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(50)
  phone?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(300)
  email?: string | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(300)
  position?: string | null;

  @ApiPropertyOptional({ type: [String], enum: CONTACT_CHANNEL_VALUES })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(CONTACT_CHANNEL_VALUES, { each: true, message: 'Допустимые значения: EMAIL, PHONE, TELEGRAM, MAX' })
  channels?: ContactChannelValue[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(300, { each: true })
  products?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class VendorContactDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid', description: 'Запись реестра персональных данных' })
  personId!: string;

  @ApiProperty()
  fullName!: string;

  @ApiProperty({ nullable: true, example: '+79001112233' })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  position!: string | null;

  @ApiProperty({ type: [String], enum: CONTACT_CHANNEL_VALUES })
  channels!: ContactChannelValue[];

  @ApiProperty({ type: [String] })
  products!: string[];

  @ApiProperty()
  isPrimary!: boolean;
}

export class VendorImportQueryDto {
  @ApiPropertyOptional({
    description:
      'true — только показать, что произойдёт, ничего не записывая. По умолчанию true: ' +
      'применение требует явного dryRun=false.',
    default: true,
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  dryRun?: boolean;
}

export class VendorImportRowDto {
  @ApiProperty({ description: 'Номер строки в файле' })
  rowNumber!: number;

  @ApiProperty({ nullable: true })
  vendorName!: string | null;

  @ApiProperty({ type: [String] })
  products!: string[];

  @ApiProperty({ nullable: true, description: 'ФИО контактного лица' })
  contactName!: string | null;

  @ApiProperty({
    enum: ['CREATED', 'UPDATED', 'UNCHANGED', 'REJECTED'],
    description: 'Итог по строке',
  })
  outcome!: 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'REJECTED';

  @ApiProperty({ type: [String], description: 'Что принято с оговоркой' })
  warnings!: string[];

  @ApiProperty({ type: [String], description: 'Почему строка отклонена' })
  errors!: string[];
}

export class VendorImportTotalsDto {
  @ApiProperty() rows!: number;
  @ApiProperty() rejected!: number;
  @ApiProperty() vendorsCreated!: number;
  @ApiProperty() productsCreated!: number;
  @ApiProperty() contactsCreated!: number;
  @ApiProperty() contactsUpdated!: number;
}

export class VendorImportResultDto {
  @ApiProperty({ description: 'Предварительный просмотр: в базе ничего не изменилось' })
  dryRun!: boolean;

  @ApiProperty({
    description: 'Как сопоставлены колонки файла: поле системы → заголовок',
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  mapping!: Record<string, string>;

  @ApiProperty({ type: [String], description: 'Колонки файла, которые не удалось сопоставить' })
  unmappedHeaders!: string[];

  @ApiProperty({ type: VendorImportTotalsDto })
  totals!: VendorImportTotalsDto;

  @ApiProperty({ type: [VendorImportRowDto] })
  rows!: VendorImportRowDto[];
}

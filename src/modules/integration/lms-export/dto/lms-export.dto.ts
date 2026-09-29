import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ToBoolean } from '../../../../common/dto/query-transforms.js';

/** Отбор слушателей для выгрузки в LMS. */
export class LmsExportFilterDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Только слушатели этой программы' })
  @IsOptional()
  @IsUUID(undefined, { message: 'Идентификатор программы должен быть UUID' })
  programId?: string;

  @ApiPropertyOptional({ description: 'Только этот поток: «3», «3 поток» — одно и то же', example: '3' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  stream?: string;

  @ApiPropertyOptional({
    description: 'Включать уже выгруженных — для повторной загрузки после сбоя на стороне LMS',
    default: false,
  })
  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includeExported?: boolean;
}

export class LmsExportRequestDto extends LmsExportFilterDto {
  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description: 'Выгрузить только этих слушателей (заявки); пусто — всех, кто подходит под отбор',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2000)
  @IsUUID(undefined, { each: true, message: 'Идентификаторы заявок должны быть UUID' })
  engagementIds?: string[];

  @ApiPropertyOptional({
    description:
      'Отметить выгруженных как переданных в LMS. false — скачать файл для проверки, ' +
      'не меняя отметок',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  markExported?: boolean;
}

export class LmsCandidateDto {
  @ApiProperty({ format: 'uuid' })
  engagementId!: string;

  @ApiProperty({ nullable: true })
  lastName!: string | null;

  @ApiProperty({ nullable: true })
  firstName!: string | null;

  @ApiProperty({ nullable: true })
  middleName!: string | null;

  @ApiProperty({ nullable: true, example: '+79001112233' })
  phone!: string | null;

  @ApiProperty({ nullable: true })
  email!: string | null;

  @ApiProperty({ nullable: true })
  programName!: string | null;

  @ApiProperty({ nullable: true })
  stream!: string | null;

  @ApiProperty({ nullable: true, description: 'Ответственный за заявку' })
  ownerName!: string | null;

  @ApiProperty({ format: 'date-time' })
  paymentConfirmedAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true })
  lmsExportedAt!: string | null;

  @ApiProperty({ description: 'Готов к выгрузке: есть фамилия, имя и почта' })
  ready!: boolean;

  @ApiProperty({ type: [String], description: 'Чего не хватает; блокирующее — без почты и ФИО' })
  issues!: string[];
}

export class LmsCandidateListDto {
  @ApiProperty({ type: [LmsCandidateDto] })
  items!: LmsCandidateDto[];

  @ApiProperty({ description: 'Сколько слушателей подходит под отбор' })
  total!: number;

  @ApiProperty({ description: 'Сколько из них готовы к выгрузке' })
  ready!: number;

  @ApiProperty({ description: 'Список обрезан по пределу одной выгрузки' })
  truncated!: boolean;
}

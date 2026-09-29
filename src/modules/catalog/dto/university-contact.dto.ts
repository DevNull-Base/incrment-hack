import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';

const LICENSE_TRANSFER_STATUS_VALUES = ['NOT_STARTED', 'IN_PROGRESS', 'TRANSFERRED', 'REJECTED'] as const;
const LICENSE_VALIDITY_VALUES = ['ACTIVE', 'EXPIRED', 'UNKNOWN'] as const;

export class CreateUniversityContactDto {
  @ApiProperty({ example: 'Кошкина Мария Андреевна' })
  @IsString()
  @MinLength(2, { message: 'Укажите ФИО' })
  @MaxLength(300)
  fullName!: string;

  @ApiPropertyOptional({
    description: 'Телефон в любом формате — будет приведён к +7XXXXXXXXXX',
    example: '8 (900) 111-22-33',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @ApiPropertyOptional({ example: 'koshkina.ma@example.ru' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  email?: string;

  @ApiPropertyOptional({ description: 'Должность', example: 'Проректор по цифровой трансформации' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  position?: string;

  @ApiPropertyOptional({
    description: 'Роль во взаимодействии со Школой',
    example: 'Ответственный за практику',
  })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  role?: string;

  @ApiPropertyOptional({ description: 'Основной контакт вуза', default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

/**
 * Правка контакта вуза. null очищает необязательное поле.
 *
 * ФИО и уже сохранённые почту и телефон меняют руководитель
 * и администратор; ответственный по заявке с вузом дописывает
 * недостающее, должность и роль.
 */
export class UpdateUniversityContactDto {
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

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(300)
  role?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class UniversityContactDto {
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

  @ApiProperty({ nullable: true, description: 'Должность' })
  position!: string | null;

  @ApiProperty({ nullable: true, description: 'Роль во взаимодействии со Школой' })
  role!: string | null;

  @ApiProperty()
  isPrimary!: boolean;

  @ApiProperty({ description: 'Когда человек указан контактом вуза' })
  createdAt!: Date;
}

export class UniversityContactResultDto extends UniversityContactDto {
  @ApiProperty({
    type: [String],
    description:
      'Что принято с оговоркой: человек найден в реестре, а часть введённого расходится с сохранённым',
  })
  warnings!: string[];
}

export class UniversityLicenseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  productId!: string;

  @ApiProperty({ example: 'RT.DataLake' })
  productName!: string;

  @ApiProperty({ nullable: true, example: 'ООО «ТДата»' })
  vendorName!: string | null;

  @ApiProperty({ nullable: true, description: 'Подписание лицензии', example: '2025-09-01' })
  signedAt!: string | null;

  @ApiProperty({ nullable: true, description: 'Срок действия, лет' })
  validYears!: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Окончание срока: дата подписания плюс срок действия. В этот день лицензия уже не действует',
    example: '2026-09-01',
  })
  validUntil!: string | null;

  @ApiProperty({
    enum: LICENSE_VALIDITY_VALUES,
    description: 'Действует ли лицензия сегодня; UNKNOWN — не указан срок',
  })
  validity!: (typeof LICENSE_VALIDITY_VALUES)[number];

  @ApiProperty({ enum: LICENSE_TRANSFER_STATUS_VALUES, description: 'Статус передачи лицензии' })
  transferStatus!: (typeof LICENSE_TRANSFER_STATUS_VALUES)[number];

  @ApiProperty({ nullable: true })
  comment!: string | null;
}

export class UniversityContractDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Д-2025/117' })
  number!: string;

  @ApiProperty({ nullable: true, description: 'Дата подписания договора', example: '2025-08-20' })
  signedAt!: string | null;

  @ApiProperty({ nullable: true })
  comment!: string | null;

  @ApiProperty({ type: [UniversityLicenseDto] })
  licenses!: UniversityLicenseDto[];
}

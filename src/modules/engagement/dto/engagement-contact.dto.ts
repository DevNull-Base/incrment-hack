import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Контактное лицо заявки прямой продажи. */
export class EngagementContactDto {
  @ApiProperty({ format: 'uuid', description: 'Запись реестра персональных данных' })
  personId!: string;

  @ApiProperty({ example: 'Петрова Анна Сергеевна' })
  fullName!: string;

  @ApiProperty({ nullable: true, example: 'petrova.as@example.ru' })
  email!: string | null;

  @ApiProperty({ nullable: true, example: '+79001112233' })
  phone!: string | null;
}

/**
 * Недостающие контакты. Заполняются только пустые поля: изменить уже
 * сохранённое значение — это уточнение персональных данных, и его выполняет
 * администратор через реестр (PATCH /persons/{id}).
 */
export class FillEngagementContactDto {
  @ApiPropertyOptional({ description: 'Почта — например, для учётной записи LMS', example: 'petrova.as@example.ru' })
  @IsOptional()
  @IsString()
  @MaxLength(320)
  email?: string;

  @ApiPropertyOptional({ description: 'Телефон в любом виде — будет приведён к +7XXXXXXXXXX', example: '8 900 111-22-33' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;
}

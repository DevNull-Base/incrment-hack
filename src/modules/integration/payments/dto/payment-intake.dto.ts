import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { ToBoolean } from '../../../../common/dto/query-transforms.js';

export const PAYMENT_OUTCOMES = ['CREATED', 'UPDATED', 'UNCHANGED', 'REJECTED'] as const;
export type PaymentOutcome = (typeof PAYMENT_OUTCOMES)[number];

export class PaymentImportQueryDto {
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

export class PaymentItemDto {
  @ApiProperty({ description: 'Номер записи: порядковый в JSON (с единицы), номер строки в таблице' })
  position!: number;

  @ApiProperty({ nullable: true, example: 'ORD-20260917143022-K7QX2M' })
  orderNumber!: string | null;

  @ApiProperty({ nullable: true, example: 'Петрова Анна Сергеевна' })
  fullName!: string | null;

  @ApiProperty({ nullable: true, description: 'Курс, как он назван в источнике' })
  course!: string | null;

  @ApiProperty({ nullable: true, description: 'Программа каталога, с которой сопоставлен курс' })
  programName!: string | null;

  @ApiProperty({ nullable: true, example: '3' })
  stream!: string | null;

  @ApiProperty({ nullable: true, format: 'uuid', description: 'Заявка, к которой отнесена оплата' })
  engagementId!: string | null;

  @ApiProperty({
    enum: PAYMENT_OUTCOMES,
    description:
      'CREATED — заведена новая заявка; UPDATED — оплата отмечена в существующей; ' +
      'UNCHANGED — оплата уже была учтена (повторная доставка); REJECTED — запись не принята',
  })
  outcome!: PaymentOutcome;

  @ApiProperty({ type: [String], description: 'Что принято с оговоркой' })
  warnings!: string[];

  @ApiProperty({ type: [String], description: 'Почему запись не принята' })
  errors!: string[];
}

export class PaymentTotalsDto {
  @ApiProperty({ description: 'Записей в источнике, включая пустые' }) records!: number;
  @ApiProperty() created!: number;
  @ApiProperty() updated!: number;
  @ApiProperty() unchanged!: number;
  @ApiProperty() rejected!: number;
  @ApiProperty({ description: 'Новых записей о людях в реестре персональных данных' })
  personsCreated!: number;
}

export class PaymentIntakeResultDto {
  @ApiProperty({ description: 'Предварительный просмотр: в базе ничего не изменилось' })
  dryRun!: boolean;

  @ApiProperty({ type: PaymentTotalsDto })
  totals!: PaymentTotalsDto;

  @ApiProperty({ type: [PaymentItemDto] })
  items!: PaymentItemDto[];
}

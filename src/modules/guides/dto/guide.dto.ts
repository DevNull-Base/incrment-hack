import { ApiProperty } from '@nestjs/swagger';

export class GuideSummaryDto {
  @ApiProperty({ description: 'Идентификатор раздела', example: 'user' })
  slug!: string;

  @ApiProperty({ example: 'Руководство пользователя' })
  title!: string;

  @ApiProperty({ description: 'О чём раздел' })
  description!: string;

  @ApiProperty({ description: 'Порядок вывода в оглавлении' })
  order!: number;

  @ApiProperty({ description: 'Когда раздел обновлялся' })
  updatedAt!: Date;
}

export class GuideDto extends GuideSummaryDto {
  @ApiProperty({
    description:
      'Текст раздела в разметке Markdown. Внешних ссылок не содержит: ' +
      'документация должна открываться в закрытом контуре.',
  })
  content!: string;
}

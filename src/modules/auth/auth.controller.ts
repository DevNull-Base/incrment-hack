import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import { UserRole } from '../../generated/prisma/enums.js';
import { CurrentUser } from './current-user.decorator.js';
import { DataScopeService } from '../access/data-scope.service.js';
import { PrismaService } from '../../infrastructure/prisma/prisma.service.js';
import type { AuthenticatedUser } from './authenticated-user.js';

class DataScopeSummaryDto {
  @ApiProperty({
    description: 'Ограничен ли доступ к данным. false — пользователь видит все записи.',
    example: true,
  })
  restricted!: boolean;

  @ApiProperty({
    description: 'Число доступных ответственных; null — без ограничения',
    nullable: true,
    example: 3,
  })
  ownerCount!: number | null;

  @ApiProperty({
    description: 'Число доступных вузов; null — без ограничения',
    nullable: true,
    example: null,
  })
  universityCount!: number | null;
}

class CurrentUserDto {
  @ApiProperty({ description: 'Внутренний идентификатор пользователя', format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Адрес электронной почты' })
  email!: string;

  @ApiProperty({ description: 'Отображаемое имя' })
  displayName!: string;

  @ApiProperty({ description: 'Роль в системе', enum: ['USER', 'MANAGER', 'ADMIN'] })
  role!: UserRole;

  @ApiProperty({ description: 'Идентификатор руководителя', nullable: true, format: 'uuid' })
  managerId!: string | null;

  @ApiProperty({
    description:
      'Имя руководителя. Справочник сотрудников открыт только администратору, ' +
      'а в профиле КАМа руководитель должен быть назван по имени, а не идентификатором.',
    nullable: true,
    example: 'Петров Сергей',
  })
  managerName!: string | null;

  @ApiProperty({ description: 'Сводка об области видимости данных', type: DataScopeSummaryDto })
  dataScope!: DataScopeSummaryDto;
}

@ApiTags('Администрирование')
@ApiBearerAuth('keycloak')
@Controller({ path: 'auth', version: '1' })
export class AuthController {
  constructor(
    private readonly dataScope: DataScopeService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Профиль текущего пользователя и границы доступных ему данных.
   *
   * Фронтенду метод нужен сразу после входа: по роли строится состав меню,
   * а по сводке области видимости — подсказка «показаны только ваши записи».
   */
  @Get('me')
  @ApiOperation({ summary: 'Профиль текущего пользователя' })
  @ApiOkResponse({ type: CurrentUserDto })
  async me(@CurrentUser() user: AuthenticatedUser): Promise<CurrentUserDto> {
    const [scope, manager] = await Promise.all([
      this.dataScope.resolve(user),
      user.managerId
        ? this.prisma.appUser.findUnique({ where: { id: user.managerId }, select: { displayName: true } })
        : null,
    ]);

    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      managerId: user.managerId,
      managerName: manager?.displayName ?? null,
      dataScope: {
        restricted: scope.ownerIds !== null || scope.universityIds !== null,
        ownerCount: scope.ownerIds?.length ?? null,
        universityCount: scope.universityIds?.length ?? null,
      },
    };
  }
}

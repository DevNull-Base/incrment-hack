import { Module } from '@nestjs/common';
import {
  ItDirectionController,
  ItProgramController,
  LearningStreamController,
  SoftwareProductController,
  UniversityController,
  UniversityNotesController,
  VendorController,
} from './catalog.controller.js';
import { UniversityNotesService } from './university-notes.service.js';
import { LearningStreamService } from './learning-stream.service.js';
import { UniversityService } from './university.service.js';
import { UniversityDirectoryService } from './university-directory.service.js';
import { ReferenceService } from './reference.service.js';
import { VendorDirectoryService } from './vendor-directory.service.js';
import { FilesModule } from '../files/files.module.js';

/**
 * Каталоги системы: вузы, вендоры, ИТ-продукты, ИТ-направления и программы.
 *
 * Требование ТЗ: справочники хранятся в БД и актуализируются как через
 * интерфейс, так и подгрузкой XLS/XLSX. Сервисы этого модуля используются
 * и контроллерами, и модулем импорта — логика создания записи едина
 * независимо от источника данных.
 */
@Module({
  // Модуль файлов — ради антивирусной проверки загружаемых таблиц.
  imports: [FilesModule],
  controllers: [
    UniversityController,
    VendorController,
    SoftwareProductController,
    ItDirectionController,
    ItProgramController,
    LearningStreamController,
    UniversityNotesController,
  ],
  providers: [
    UniversityService,
    UniversityDirectoryService,
    ReferenceService,
    VendorDirectoryService,
    UniversityNotesService,
    LearningStreamService,
  ],
  exports: [UniversityService, ReferenceService],
})
export class CatalogModule {}

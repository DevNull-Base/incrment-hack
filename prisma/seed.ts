/**
 * Демонстрационные данные.
 *
 * Наполняет систему правдоподобным набором: реальные вузы, ИТ-направления,
 * продукты, взаимодействия на разных стадиях процесса и историей переходов.
 * Без такого наполнения интерфейс и отчёты нечем показывать, а проверить
 * работу фильтров и агрегатов невозможно.
 *
 * Скрипт идемпотентен: повторный запуск не создаёт дубликатов, поэтому
 * его безопасно выполнять на уже наполненной базе.
 *
 * Запуск: npm run db:seed
 */
// Конфигурация читается из .env: сид запускается как самостоятельный
// скрипт, вне контекста приложения Nest.
import 'dotenv/config';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { normalizeName } from '../src/common/utils/text-normalization.js';
import {
  BASE_WORKFLOW_DEFINITION,
  BASE_WORKFLOW_KEY,
  DIRECT_SALES_WORKFLOW_DEFINITION,
  DIRECT_SALES_WORKFLOW_KEY,
} from '../src/modules/workflow/base-template.js';
import {
  addDays,
  dateFromDb,
  dateInZone,
  dateToDb,
  timeInZone,
  zonedToUtc,
} from '../src/modules/planner/planner-dates.js';
import {
  buildEscalationForManagerText,
  buildEscalationText,
  buildTaskAssignedText,
  escalationDedupeKey,
} from '../src/modules/notification/notification-messages.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('Не задана переменная DATABASE_URL');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

// ---------------------------------------------------------------------------
//  Исходные наборы
// ---------------------------------------------------------------------------

/**
 * Вендоры и продукты — по каталогу, переданному заказчиком: компании группы
 * «Ростелеком» и их продукты. Названия компаний — с правовой формой, как
 * в каталоге заказчика. Описание указано только там, где назначение
 * продукта известно достоверно; остальное заполнит администратор.
 */
const VENDORS = ['ООО «Базис»', 'ООО «ТДата»', 'ПАО «Ростелеком»', 'ООО «РТК ИТ Плюс»', 'ООО «РТК ИТ»'];

const PRODUCTS: ReadonlyArray<{ name: string; vendor: string; description: string | null }> = [
  { name: 'Базис Dynamix', vendor: 'ООО «Базис»', description: 'Платформа виртуализации' },
  { name: 'RT.DataLake', vendor: 'ООО «ТДата»', description: 'Платформа хранения и обработки больших данных' },
  { name: 'RT.Warehouse', vendor: 'ООО «ТДата»', description: 'Аналитическое хранилище данных' },
  { name: 'RT.DataVision', vendor: 'ПАО «Ростелеком»', description: null },
  { name: 'AKOLA', vendor: 'ООО «РТК ИТ Плюс»', description: null },
  { name: 'Яга', vendor: 'ООО «РТК ИТ Плюс»', description: null },
  { name: 'Web3Gate', vendor: 'ООО «РТК ИТ»', description: null },
  { name: 'Аврора SDK', vendor: 'ООО «РТК ИТ»', description: 'Инструменты разработки приложений для ОС «Аврора»' },
  { name: 'Нейрошлюз', vendor: 'ООО «РТК ИТ»', description: null },
];

/**
 * Вендоры прежнего демонстрационного набора. На уже наполненной базе они
 * выводятся из действия (заявки и лицензии на них остаются), а «Ростелеком»
 * переименовывается в «ПАО «Ростелеком»» — с сохранением всех связей.
 */
const LEGACY_DEMO_VENDORS = ['Группа Астра', 'Postgres Professional', 'Яндекс', '1С', 'БАЗАЛЬТ СПО'];
const LEGACY_DEMO_PRODUCTS = ['РТК Облако', 'РТК Аналитика'];
const LEGACY_DEMO_PROGRAMS = ['Промышленная разработка на 1С'];

/**
 * Контактные лица вендоров — вымышленные. Структура повторяет каталог
 * заказчика (ФИО, телефон, почта, способ связи), но сами контакты из него
 * в репозиторий не переносятся: это персональные данные реальных людей.
 */
const VENDOR_CONTACTS: ReadonlyArray<{
  vendor: string;
  fullName: string;
  phone: string;
  email: string;
  channels: Array<'EMAIL' | 'PHONE' | 'TELEGRAM' | 'MAX'>;
}> = [
  { vendor: 'ООО «Базис»', fullName: 'Гордеев Илья Сергеевич', phone: '+79000000101', email: 'gordeev.is@example.ru', channels: ['EMAIL', 'TELEGRAM'] },
  { vendor: 'ООО «ТДата»', fullName: 'Мельникова Анна Викторовна', phone: '+79000000102', email: 'melnikova.av@example.ru', channels: ['EMAIL'] },
  { vendor: 'ПАО «Ростелеком»', fullName: 'Тихонов Роман Андреевич', phone: '+79000000103', email: 'tikhonov.ra@example.ru', channels: ['PHONE', 'EMAIL'] },
  { vendor: 'ООО «РТК ИТ Плюс»', fullName: 'Жукова Дарья Олеговна', phone: '+79000000104', email: 'zhukova.do@example.ru', channels: ['TELEGRAM'] },
  { vendor: 'ООО «РТК ИТ»', fullName: 'Сорокин Глеб Павлович', phone: '+79000000105', email: 'sorokin.gp@example.ru', channels: ['EMAIL', 'MAX'] },
];

const DIRECTIONS: ReadonlyArray<{ name: string; code: string }> = [
  { name: 'DevOps', code: 'DEVOPS' },
  { name: 'Тестирование ПО (QA)', code: 'QA' },
  { name: 'Информационная безопасность', code: 'INFOSEC' },
  { name: 'Аналитика данных', code: 'DATA' },
  { name: 'Разработка программного обеспечения', code: 'DEV' },
  { name: 'Облачные технологии', code: 'CLOUD' },
  { name: 'Системное администрирование', code: 'SYSADMIN' },
  { name: 'Управление ИТ-проектами', code: 'PM' },
  { name: 'Искусственный интеллект', code: 'AI' },
  { name: 'Дизайн', code: 'DESIGN' },
  { name: 'Техническая поддержка', code: 'SUPPORT' },
];

/** Карточка программы в каталоге курсов. */
interface ProgramCard {
  source: 'RTK_SCHOOL' | 'EDU_RT' | 'SZ_RT' | 'EDUPRO';
  audienceCategory: 'INDIVIDUALS' | 'SPECIALISTS' | 'STATE_PROJECT';
  description: string;
  audience: string;
  requirements: string;
}

/** Программы вузов-партнёров ИТ Школы РТК: общая аудитория и требования. */
function schoolCard(description: string, requirements: string): ProgramCard {
  return {
    source: 'RTK_SCHOOL',
    audienceCategory: 'SPECIALISTS',
    description,
    audience: 'Студенты и преподаватели вузов-партнёров ИТ Школы РТК',
    requirements,
  };
}

/**
 * Программы. Первые пять — курсы, которые продаются на сайте (названия —
 * как в выгрузке оплат заказчика): по этим названиям оплата находит свою
 * программу. Продолжительность у них не указана — её в выгрузке нет.
 *
 * Карточка каталога курсов (проект, аудитория, описание) заполняется
 * сидом, только пока описание пустое: правки, сделанные в системе,
 * повторное наполнение не перетирает.
 */
const PROGRAMS: ReadonlyArray<{
  name: string;
  direction: string;
  product?: string;
  hours?: number;
  card: ProgramCard;
}> = [
  {
    name: 'Анализ данных без программирования', direction: 'DATA', product: 'RT.DataVision',
    card: {
      source: 'EDU_RT', audienceCategory: 'INDIVIDUALS',
      description: 'Дашборды и отчёты в RT.DataVision без единой строки кода: от выгрузки до презентации выводов.',
      audience: 'Начинающие аналитики и специалисты, работающие с таблицами',
      requirements: 'Уверенная работа с электронными таблицами; паспорт и диплом для оформления документов',
    },
  },
  {
    name: 'Инженер-тестировщик', direction: 'QA',
    card: {
      source: 'EDU_RT', audienceCategory: 'INDIVIDUALS',
      description: 'Онлайн-курс: ручное тестирование, SQL, основы Python и автоматизации проверок.',
      audience: 'Начинающие тестировщики и специалисты, входящие в разработку',
      requirements: 'Компьютер с доступом в интернет; паспорт и диплом для оформления документов',
    },
  },
  {
    name: 'Управление ИТ-проектами на базе программного продукта ПАО «Ростелеком»', direction: 'PM',
    card: {
      source: 'EDU_RT', audienceCategory: 'SPECIALISTS',
      description: 'Проектный подход, требования, риски и планирование работ в системе «Яга».',
      audience: 'Руководители команд, ИТ-менеджеры, сотрудники организаций-партнёров',
      requirements: 'Опыт участия в проектах; паспорт и диплом для оформления документов',
    },
  },
  {
    name: 'Промпт-инжиниринг', direction: 'AI',
    card: {
      source: 'EDU_RT', audienceCategory: 'INDIVIDUALS',
      description: 'Работа с большими языковыми моделями в учебных, аналитических и рабочих задачах.',
      audience: 'Все, кто хочет применять нейросети в работе; подготовка не требуется',
      requirements: 'Доступ в интернет; паспорт для оформления договора',
    },
  },
  {
    name: 'Python-разработчик с использованием инструментов ИИ', direction: 'DEV',
    card: {
      source: 'EDU_RT', audienceCategory: 'INDIVIDUALS',
      description: 'От основ Python до работы с данными и ИИ-ассистентами в разработке.',
      audience: 'Новички и специалисты, совмещающие обучение с работой',
      requirements: 'Компьютер с доступом в интернет; паспорт и диплом для оформления документов',
    },
  },
  {
    name: 'Основы DevOps-практик', direction: 'DEVOPS', product: 'Базис Dynamix', hours: 72,
    card: schoolCard(
      'Контейнеризация, управление конфигурациями и виртуальная инфраструктура на Базис Dynamix.',
      'Основы Linux и сетей',
    ),
  },
  {
    name: 'Непрерывная интеграция и доставка', direction: 'DEVOPS', hours: 108,
    card: schoolCard('Сборочные конвейеры, автоматические проверки и выкладка без простоя.', 'Опыт работы с Git'),
  },
  {
    name: 'Автоматизация тестирования', direction: 'QA', hours: 96,
    card: schoolCard('Автотесты интерфейса и API, отчётность и встраивание тестов в конвейер сборки.', 'Основы программирования'),
  },
  {
    name: 'Ручное тестирование и документирование', direction: 'QA', hours: 64,
    card: schoolCard('Тест-дизайн, чек-листы, баг-репорты и тестовая документация.', 'Подготовка не требуется'),
  },
  {
    name: 'Защита информации в ГИС', direction: 'INFOSEC', hours: 144,
    card: schoolCard(
      'Требования 152-ФЗ и приказа ФСТЭК № 117, модель угроз и защита государственных информационных систем.',
      'Основы сетей и администрирования',
    ),
  },
  {
    name: 'Анализ данных и визуализация', direction: 'DATA', product: 'RT.DataVision', hours: 108,
    card: schoolCard('Подготовка данных, визуализация и построение аналитических панелей в RT.DataVision.', 'Базовый SQL'),
  },
  {
    name: 'Машинное обучение на практике', direction: 'DATA', product: 'RT.DataLake', hours: 144,
    card: schoolCard('Модели машинного обучения на данных RT.DataLake: от признаков до внедрения.', 'Python и математическая статистика'),
  },
  {
    name: 'Базы данных и SQL', direction: 'DEV', product: 'RT.Warehouse', hours: 96,
    card: schoolCard('Проектирование схем, запросы и оптимизация на аналитическом хранилище RT.Warehouse.', 'Подготовка не требуется'),
  },
  {
    name: 'Разработка приложений на Аврора SDK', direction: 'DEV', product: 'Аврора SDK', hours: 108,
    card: schoolCard('Мобильные приложения для ОС «Аврора»: интерфейс, данные, публикация.', 'Основы C++ или Qt'),
  },
  {
    name: 'Администрирование облачной инфраструктуры', direction: 'CLOUD', product: 'Базис Dynamix', hours: 108,
    card: schoolCard('Развёртывание и сопровождение частного облака на платформе Базис Dynamix.', 'Администрирование Linux'),
  },
  {
    name: 'Виртуализация рабочих мест', direction: 'CLOUD', product: 'Базис Dynamix', hours: 72,
    card: schoolCard('Виртуальные рабочие места для компьютерных классов и кафедр.', 'Основы администрирования'),
  },
  {
    name: 'Администрирование Linux', direction: 'SYSADMIN', hours: 96,
    card: schoolCard('Установка, настройка и сопровождение серверов на отечественных дистрибутивах Linux.', 'Подготовка не требуется'),
  },
  // Федеральный проект «Активные меры содействия занятости» (sz-rt):
  // бесплатное обучение для граждан категорий проекта.
  {
    name: 'Основы UX/UI-дизайна', direction: 'DESIGN', hours: 144,
    card: {
      source: 'SZ_RT', audienceCategory: 'STATE_PROJECT',
      description: 'Очно-заочно с применением ДОТ: от основ пользовательского опыта до макетов интерфейсов.',
      audience: 'Граждане категорий федерального проекта «Активные меры содействия занятости»',
      requirements: 'Паспорт, документ об образовании, подтверждённая заявка на портале «Работа России»',
    },
  },
  {
    name: 'Введение в информационную безопасность', direction: 'INFOSEC', hours: 72,
    card: {
      source: 'SZ_RT', audienceCategory: 'STATE_PROJECT',
      description: 'Базовые принципы защиты данных, работа с инцидентами и рисками.',
      audience: 'Граждане категорий федерального проекта, меняющие профессию',
      requirements: 'Паспорт, документ об образовании, подтверждённая заявка на портале «Работа России»',
    },
  },
  {
    name: 'Специалист технической поддержки 1 линии', direction: 'SUPPORT', hours: 72,
    card: {
      source: 'SZ_RT', audienceCategory: 'STATE_PROJECT',
      description: 'Очно-заочно с ДОТ на примере решений ПАО «Ростелеком»: обращения, регламенты, базовая диагностика.',
      audience: 'Граждане категорий федерального проекта, начинающие специалисты',
      requirements: 'Паспорт, подтверждённая заявка, базовые навыки работы с компьютером',
    },
  },
  {
    name: 'Анализ данных в Low-code платформах', direction: 'DATA', hours: 144,
    card: {
      source: 'SZ_RT', audienceCategory: 'STATE_PROJECT',
      description: 'Дашборды и аналитика без программирования в low-code среде.',
      audience: 'Граждане категорий федерального проекта, аналитики-новички',
      requirements: 'Паспорт, подтверждённая заявка, базовые навыки работы с таблицами',
    },
  },
  {
    name: 'Графический дизайн интерфейсов', direction: 'DESIGN', hours: 90,
    card: {
      source: 'EDU_RT', audienceCategory: 'INDIVIDUALS',
      description: 'Онлайн-программа: композиция, типографика, экранные решения; документы РАНХиГС.',
      audience: 'Начинающие дизайнеры и специалисты, совмещающие обучение с работой',
      requirements: 'Компьютер с доступом в интернет; паспорт и диплом для оформления документов',
    },
  },
  {
    name: 'Графический дизайн интерфейсов — корпоративный поток', direction: 'DESIGN', hours: 72,
    card: {
      source: 'EDUPRO', audienceCategory: 'SPECIALISTS',
      description: 'Корпоративная программа для сотрудников партнёров: дизайн интерфейсов под задачи компании.',
      audience: 'Сотрудники компаний-партнёров и внутренние подразделения',
      requirements: 'Направление от работодателя',
    },
  },
];

const UNIVERSITIES: ReadonlyArray<{ name: string; short: string; region: string; city: string }> = [
  { name: 'Московский государственный технический университет имени Н.Э. Баумана', short: 'МГТУ им. Баумана', region: 'Москва', city: 'Москва' },
  { name: 'Национальный исследовательский университет «Высшая школа экономики»', short: 'НИУ ВШЭ', region: 'Москва', city: 'Москва' },
  { name: 'Московский физико-технический институт', short: 'МФТИ', region: 'Московская область', city: 'Долгопрудный' },
  { name: 'Национальный исследовательский ядерный университет «МИФИ»', short: 'НИЯУ МИФИ', region: 'Москва', city: 'Москва' },
  { name: 'Российский технологический университет МИРЭА', short: 'РТУ МИРЭА', region: 'Москва', city: 'Москва' },
  { name: 'Московский авиационный институт', short: 'МАИ', region: 'Москва', city: 'Москва' },
  { name: 'Санкт-Петербургский государственный университет', short: 'СПбГУ', region: 'Санкт-Петербург', city: 'Санкт-Петербург' },
  { name: 'Санкт-Петербургский политехнический университет Петра Великого', short: 'СПбПУ', region: 'Санкт-Петербург', city: 'Санкт-Петербург' },
  { name: 'Университет ИТМО', short: 'ИТМО', region: 'Санкт-Петербург', city: 'Санкт-Петербург' },
  { name: 'Санкт-Петербургский государственный электротехнический университет «ЛЭТИ»', short: 'СПбГЭТУ ЛЭТИ', region: 'Санкт-Петербург', city: 'Санкт-Петербург' },
  { name: 'Казанский федеральный университет', short: 'КФУ', region: 'Республика Татарстан', city: 'Казань' },
  { name: 'Казанский национальный исследовательский технический университет имени А.Н. Туполева', short: 'КНИТУ-КАИ', region: 'Республика Татарстан', city: 'Казань' },
  { name: 'Новосибирский государственный университет', short: 'НГУ', region: 'Новосибирская область', city: 'Новосибирск' },
  { name: 'Новосибирский государственный технический университет', short: 'НГТУ', region: 'Новосибирская область', city: 'Новосибирск' },
  { name: 'Томский государственный университет', short: 'ТГУ', region: 'Томская область', city: 'Томск' },
  { name: 'Томский политехнический университет', short: 'ТПУ', region: 'Томская область', city: 'Томск' },
  { name: 'Уральский федеральный университет имени Б.Н. Ельцина', short: 'УрФУ', region: 'Свердловская область', city: 'Екатеринбург' },
  { name: 'Южный федеральный университет', short: 'ЮФУ', region: 'Ростовская область', city: 'Ростов-на-Дону' },
  { name: 'Дальневосточный федеральный университет', short: 'ДВФУ', region: 'Приморский край', city: 'Владивосток' },
  { name: 'Сибирский федеральный университет', short: 'СФУ', region: 'Красноярский край', city: 'Красноярск' },
  { name: 'Нижегородский государственный университет имени Н.И. Лобачевского', short: 'ННГУ', region: 'Нижегородская область', city: 'Нижний Новгород' },
  { name: 'Самарский национальный исследовательский университет имени С.П. Королёва', short: 'Самарский университет', region: 'Самарская область', city: 'Самара' },
  { name: 'Пермский национальный исследовательский политехнический университет', short: 'ПНИПУ', region: 'Пермский край', city: 'Пермь' },
  { name: 'Воронежский государственный университет', short: 'ВГУ', region: 'Воронежская область', city: 'Воронеж' },
  { name: 'Южно-Уральский государственный университет', short: 'ЮУрГУ', region: 'Челябинская область', city: 'Челябинск' },
  { name: 'Балтийский федеральный университет имени Иммануила Канта', short: 'БФУ', region: 'Калининградская область', city: 'Калининград' },
  { name: 'Северо-Кавказский федеральный университет', short: 'СКФУ', region: 'Ставропольский край', city: 'Ставрополь' },
  { name: 'Северный (Арктический) федеральный университет', short: 'САФУ', region: 'Архангельская область', city: 'Архангельск' },
  { name: 'Омский государственный технический университет', short: 'ОмГТУ', region: 'Омская область', city: 'Омск' },
  { name: 'Иркутский национальный исследовательский технический университет', short: 'ИРНИТУ', region: 'Иркутская область', city: 'Иркутск' },
  { name: 'Волгоградский государственный технический университет', short: 'ВолгГТУ', region: 'Волгоградская область', city: 'Волгоград' },
  { name: 'Саратовский национальный исследовательский государственный университет', short: 'СГУ', region: 'Саратовская область', city: 'Саратов' },
  { name: 'Тюменский государственный университет', short: 'ТюмГУ', region: 'Тюменская область', city: 'Тюмень' },
  { name: 'Уфимский университет науки и технологий', short: 'УУНиТ', region: 'Республика Башкортостан', city: 'Уфа' },
  { name: 'Белгородский государственный национальный исследовательский университет', short: 'НИУ БелГУ', region: 'Белгородская область', city: 'Белгород' },
];

const CONTACT_NAMES = [
  'Смирнов Алексей Викторович', 'Кузнецова Ольга Петровна', 'Попов Сергей Николаевич',
  'Васильева Ирина Дмитриевна', 'Новиков Андрей Сергеевич', 'Фёдорова Марина Игоревна',
  'Морозов Павел Юрьевич', 'Волкова Екатерина Андреевна', 'Алексеев Роман Олегович',
  'Лебедева Наталья Сергеевна', 'Семёнов Виктор Михайлович', 'Егорова Татьяна Владимировна',
  'Павлов Денис Александрович', 'Козлова Светлана Юрьевна', 'Степанов Максим Игоревич',
];

const COMMENTS_BY_STATE: Record<string, string[]> = {
  CONTACT_SEARCH: ['Найден контакт заведующего кафедрой', 'Получены контакты через приёмную ректора'],
  COMMUNICATION: ['Обсудили актуальность программы, интерес подтверждён', 'Запросили перечень действующих дисциплин'],
  MEETING: ['Встреча проведена, согласован состав пилота', 'Договорились о запуске с осеннего семестра'],
  DOCUMENTS_EXCHANGE: ['Направлен пакет документов на согласование', 'Документы переданы в юридический отдел вуза'],
  DOCUMENTS_REVISION: ['Вуз запросил правки в части сроков лицензии', 'Скорректирован раздел об ответственности сторон'],
  SIGNING: ['Договор подписан обеими сторонами', 'Подписано соглашение о сотрудничестве'],
  MATERIALS_TRANSFER: ['Переданы методические материалы и лицензионные ключи', 'Материалы загружены в LMS вуза'],
  IMPLEMENTATION: ['Развёрнут учебный стенд на 30 рабочих мест', 'Настроена интеграция с инфраструктурой вуза'],
  TEACHER_TRAINING: ['Обучено 6 преподавателей кафедры', 'Проведён двухдневный интенсив для преподавателей'],
  PROGRAM_UPDATE: ['Программа дисциплины дополнена практикумом', 'Утверждена обновлённая рабочая программа'],
  CLASSES: ['Занятия идут в двух потоках', 'Запущен курс для магистрантов'],
  DOCS_UPDATE: ['Обновлена документация под новую версию продукта'],
  QUALIFICATION: ['Двое преподавателей прошли повышение квалификации'],
  SUPPORT: ['Взаимодействие переведено в регулярное сопровождение'],
  REJECTED: ['Вуз сообщил об отсутствии бюджета на текущий год', 'Отказ: направление закрыто решением учёного совета'],
};

// ---------------------------------------------------------------------------
//  Детерминированный генератор псевдослучайных чисел
// ---------------------------------------------------------------------------

/**
 * Собственный генератор вместо Math.random: сид должен давать один и тот же
 * набор данных при каждом запуске. Иначе скриншоты в документации,
 * ожидаемые значения в тестах и результаты отчётов расходились бы от прогона
 * к прогону, и воспроизвести разбор ошибки было бы невозможно.
 */
function createRandom(seed: number) {
  let state = seed >>> 0;

  return {
    next(): number {
      // xorshift32
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      return state / 0xffffffff;
    },
    int(min: number, max: number): number {
      return Math.floor(this.next() * (max - min + 1)) + min;
    },
    pick<T>(items: readonly T[]): T {
      return items[Math.floor(this.next() * items.length)] as T;
    },
    chance(probability: number): boolean {
      return this.next() < probability;
    },
  };
}

const random = createRandom(20260915);

/** Дата, сдвинутая на указанное число дней назад от текущего момента. */
function daysAgo(days: number): Date {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  date.setUTCHours(9, 0, 0, 0);
  return date;
}

// ---------------------------------------------------------------------------
//  Наполнение
// ---------------------------------------------------------------------------

async function seedUsers() {
  // Учётные записи заводятся автоматически при первом входе через Keycloak.
  // Здесь фиксируется то, чего в каталоге учётных записей нет, — иерархия
  // подчинённости, от которой зависит область видимости данных руководителя.
  const manager = await prisma.appUser.upsert({
    where: { email: 'manager.petrov@rtk-it-school.ru' },
    create: {
      keycloakSub: 'seed-manager-petrov',
      email: 'manager.petrov@rtk-it-school.ru',
      displayName: 'Петров Сергей',
      role: 'MANAGER',
    },
    update: { role: 'MANAGER' },
  });

  const kamSeeds = [
    { email: 'kam.ivanova@rtk-it-school.ru', name: 'Иванова Анна', sub: 'seed-kam-ivanova' },
    { email: 'kam.orlov@rtk-it-school.ru', name: 'Орлов Дмитрий', sub: 'seed-kam-orlov' },
  ];

  const kams = [];
  for (const item of kamSeeds) {
    kams.push(
      await prisma.appUser.upsert({
        where: { email: item.email },
        create: {
          keycloakSub: item.sub,
          email: item.email,
          displayName: item.name,
          role: 'USER',
          managerId: manager.id,
        },
        update: { managerId: manager.id, role: 'USER' },
      }),
    );
  }

  await prisma.appUser.upsert({
    where: { email: 'admin.sidorov@rtk-it-school.ru' },
    create: {
      keycloakSub: 'seed-admin-sidorov',
      email: 'admin.sidorov@rtk-it-school.ru',
      displayName: 'Сидоров Игорь',
      role: 'ADMIN',
    },
    update: { role: 'ADMIN' },
  });

  return { manager, kams };
}

async function seedCatalogs() {
  // Прежний «Ростелеком» становится «ПАО «Ростелеком»» — переименованием,
  // а не новой записью: заявки и лицензии на его продукты сохраняют связь.
  const legacyRostelecom = await prisma.vendor.findUnique({ where: { name: 'Ростелеком' } });
  const currentRostelecom = await prisma.vendor.findUnique({ where: { name: 'ПАО «Ростелеком»' } });
  if (legacyRostelecom && !currentRostelecom) {
    await prisma.vendor.update({ where: { id: legacyRostelecom.id }, data: { name: 'ПАО «Ростелеком»' } });
  }

  await prisma.vendor.updateMany({ where: { name: { in: LEGACY_DEMO_VENDORS } }, data: { isActive: false } });
  await prisma.softwareProduct.updateMany({
    where: { OR: [{ vendor: { name: { in: LEGACY_DEMO_VENDORS } } }, { name: { in: LEGACY_DEMO_PRODUCTS } }] },
    data: { isActive: false },
  });
  await prisma.itProgram.updateMany({ where: { name: { in: LEGACY_DEMO_PROGRAMS } }, data: { isActive: false } });

  const vendorByName = new Map<string, string>();
  for (const name of VENDORS) {
    const vendor = await prisma.vendor.upsert({ where: { name }, create: { name }, update: { isActive: true } });
    vendorByName.set(name, vendor.id);
  }

  const productByName = new Map<string, string>();
  for (const item of PRODUCTS) {
    const vendorId = vendorByName.get(item.vendor);
    if (!vendorId) continue;

    const product = await prisma.softwareProduct.upsert({
      where: { vendorId_name: { vendorId, name: item.name } },
      create: { name: item.name, vendorId, description: item.description },
      update: { description: item.description, isActive: true },
    });
    productByName.set(item.name, product.id);
  }

  const directionByCode = new Map<string, string>();
  for (const item of DIRECTIONS) {
    const direction = await prisma.itDirection.upsert({
      where: { name: item.name },
      create: { name: item.name, code: item.code },
      update: { code: item.code },
    });
    directionByCode.set(item.code, direction.id);
  }

  for (const item of PROGRAMS) {
    const directionId = directionByCode.get(item.direction);
    if (!directionId) continue;

    const productId = item.product ? (productByName.get(item.product) ?? null) : null;

    // Продукт обновляется вместе с продолжительностью: прежние
    // демонстрационные продукты выведены из действия, и программа,
    // построенная вокруг них, переходит на продукт из каталога заказчика.
    const program = await prisma.itProgram.upsert({
      where: { directionId_name: { directionId, name: item.name } },
      create: { name: item.name, directionId, productId, hoursTotal: item.hours ?? null, ...item.card },
      update: { productId, hoursTotal: item.hours ?? null },
    });

    // Карточка каталога курсов — только пока её не заполнили в системе.
    if (program.description === null) {
      await prisma.itProgram.update({ where: { id: program.id }, data: item.card });
    }
  }

  const universityIds: string[] = [];
  for (const item of UNIVERSITIES) {
    const existing = await prisma.university.findFirst({ where: { name: item.name } });

    const record = existing
      ? await prisma.university.update({
          where: { id: existing.id },
          data: { shortName: item.short, region: item.region, city: item.city },
        })
      : await prisma.university.create({
          data: {
            name: item.name,
            shortName: item.short,
            normalizedName: normalizeName(item.name),
            region: item.region,
            city: item.city,
          },
        });

    universityIds.push(record.id);
  }

  return { vendorByName, productByName, directionByCode, universityIds };
}

/**
 * Действующий процесс сегмента.
 *
 * Базовые процессы приходят миграцией — развёрнутый экземпляр работоспособен
 * и без наполнения. Здесь они только подстраховываются: на базе, созданной
 * до появления той миграции, шаблона может не быть вовсе.
 *
 * Уже действующая редакция не трогается ни при каких условиях. Администратор
 * мог опубликовать свою — подменять её базовой означало бы откатывать
 * настройку процесса при каждом наполнении. Вдобавок попытка сделать
 * действующими сразу две редакции сегмента упёрлась бы в уникальный индекс.
 */
async function ensureSegmentTemplate(params: {
  key: string;
  segment: 'B2B' | 'B2C';
  name: string;
  description: string;
  definition: object;
}) {
  const active = await prisma.workflowTemplate.findFirst({
    where: { segment: params.segment, isActive: true, isDefault: true },
  });

  if (active) {
    return active;
  }

  return prisma.workflowTemplate.upsert({
    where: { key_version: { key: params.key, version: 1 } },
    create: {
      key: params.key,
      version: 1,
      segment: params.segment,
      name: params.name,
      description: params.description,
      definition: params.definition,
      isActive: true,
      isDefault: true,
      publishedAt: new Date(),
    },
    update: {
      definition: params.definition,
      isActive: true,
      isDefault: true,
      publishedAt: new Date(),
    },
  });
}

async function seedWorkflowTemplate() {
  const b2b = await ensureSegmentTemplate({
    key: BASE_WORKFLOW_KEY,
    segment: 'B2B',
    name: 'Взаимодействие с вузом (базовый процесс)',
    description: 'Типовой путь из 14 шагов согласно техническому заданию',
    definition: BASE_WORKFLOW_DEFINITION as unknown as object,
  });

  const b2c = await ensureSegmentTemplate({
    key: DIRECT_SALES_WORKFLOW_KEY,
    segment: 'B2C',
    name: 'Прямая работа с обучающимся (B2C)',
    description: 'Маршрут прямых продаж: заявка, оплата, доступ, обучение',
    definition: DIRECT_SALES_WORKFLOW_DEFINITION as unknown as object,
  });

  return { b2b, b2c };
}

async function seedContacts(universityIds: string[]) {
  for (const universityId of universityIds) {
    const existing = await prisma.universityContact.count({ where: { universityId } });
    if (existing > 0) continue;

    const contactCount = random.int(1, 2);
    for (let i = 0; i < contactCount; i++) {
      const fullName = random.pick(CONTACT_NAMES);
      const person = await prisma.person.create({
        data: {
          fullName,
          email: `contact${random.int(1000, 9999)}@university.example.ru`,
          phone: `+7 (${random.int(300, 999)}) ${random.int(100, 999)}-${random.int(10, 99)}-${random.int(10, 99)}`,
          position: random.pick(['Заведующий кафедрой', 'Декан факультета', 'Проректор по цифровизации', 'Доцент кафедры']),
        },
      });

      await prisma.universityContact.create({
        data: { universityId, personId: person.id, isPrimary: i === 0, role: 'Ответственный от вуза' },
      });
    }
  }
}

/**
 * Порядок состояний базового процесса — по нему строится правдоподобная
 * история переходов: взаимодействие проходит стадии последовательно,
 * а не прыгает по произвольным статусам.
 */
const MAIN_PATH = [
  'CONTACT_SEARCH', 'COMMUNICATION', 'MEETING', 'DOCUMENTS_EXCHANGE', 'SIGNING',
  'MATERIALS_TRANSFER', 'IMPLEMENTATION', 'TEACHER_TRAINING', 'PROGRAM_UPDATE',
  'CLASSES', 'DOCS_UPDATE', 'QUALIFICATION', 'SUPPORT',
];

const STATE_LABELS = new Map(BASE_WORKFLOW_DEFINITION.states.map((state) => [state.key, state.label]));

async function seedEngagements(
  universityIds: string[],
  directionIds: string[],
  productIds: string[],
  templateId: string,
  ownerIds: string[],
) {
  const existing = await prisma.engagement.count();
  if (existing > 0) {
    console.log(`  Взаимодействия уже созданы (${existing}), пропускаем.`);
    return existing;
  }

  let created = 0;

  for (const universityId of universityIds) {
    // У каждого вуза от одного до трёх направлений работы.
    const engagementCount = random.int(1, 3);
    const usedDirections = new Set<string>();

    for (let i = 0; i < engagementCount; i++) {
      const directionId = random.pick(directionIds);
      const productId = random.chance(0.85) ? random.pick(productIds) : null;

      // Естественный ключ — вуз + направление + продукт; повторы пропускаем.
      const key = `${directionId}:${productId ?? 'null'}`;
      if (usedDirections.has(key)) continue;
      usedDirections.add(key);

      // Глубина продвижения по процессу: часть взаимодействий на старте,
      // часть в середине, часть доведена до сопровождения. Такой разброс
      // нужен, чтобы воронка в отчётах выглядела осмысленно.
      const isRejected = random.chance(0.12);
      const depth = isRejected ? random.int(1, 4) : random.int(1, MAIN_PATH.length);
      const path = MAIN_PATH.slice(0, depth);
      const finalState = isRejected ? 'REJECTED' : (path[path.length - 1] as string);

      const ownerId = random.pick(ownerIds);
      const createdDaysAgo = random.int(30, 400);

      const engagement = await prisma.engagement.create({
        data: {
          universityId,
          directionId,
          productId,
          ownerId,
          currentStateKey: finalState,
          currentStateLabel: STATE_LABELS.get(finalState) ?? finalState,
          createdAt: daysAgo(createdDaysAgo),
          updatedAt: daysAgo(random.int(1, Math.max(2, createdDaysAgo - 10))),
        },
      });

      const instance = await prisma.workflowInstance.create({
        data: {
          engagementId: engagement.id,
          templateId,
          currentStateKey: finalState,
          enteredAt: daysAgo(random.int(1, 30)),
          completedAt: finalState === 'SUPPORT' || finalState === 'REJECTED' ? daysAgo(random.int(1, 20)) : null,
        },
      });

      // История переходов: от начального состояния к текущему.
      let transitionDay = createdDaysAgo;
      const fullPath = isRejected ? [...path, 'REJECTED'] : path;

      for (let step = 1; step < fullPath.length; step++) {
        const from = fullPath[step - 1] as string;
        const to = fullPath[step] as string;
        transitionDay = Math.max(1, transitionDay - random.int(5, 30));

        const comments = COMMENTS_BY_STATE[to] ?? [];

        await prisma.workflowTransition.create({
          data: {
            instanceId: instance.id,
            fromStateKey: from,
            fromStateLabel: STATE_LABELS.get(from) ?? from,
            toStateKey: to,
            toStateLabel: STATE_LABELS.get(to) ?? to,
            actorId: ownerId,
            comment: comments.length > 0 ? random.pick(comments) : null,
            createdAt: daysAgo(transitionDay),
          },
        });
      }

      created++;
    }
  }

  return created;
}

/**
 * Источники интеграции.
 *
 * Заводятся сидом, а не создаются администратором вручную: обе внешние
 * системы известны заранее, а в режиме заглушек адреса всё равно
 * не используются — обмен идёт на встроенных примерах.
 */
async function seedIntegrationSources() {
  const sources = [
    {
      type: 'LMS' as const,
      name: 'LMS ИТ Школы РТК',
      baseUrl: process.env.LMS_BASE_URL ?? 'http://mock-external:4010',
    },
    {
      type: 'WEBSITE' as const,
      name: 'Сайт ИТ Школы РТК',
      baseUrl: process.env.CMS_BASE_URL ?? 'http://mock-external:4011',
    },
  ];

  for (const source of sources) {
    await prisma.integrationSource.upsert({
      where: { name: source.name },
      create: { ...source, isEnabled: true },
      // Адрес обновляем, а курсор не трогаем: сброс курсора заставил бы
      // систему заново принять все ранее обработанные события.
      update: { baseUrl: source.baseUrl },
    });
  }

  return sources.length;
}

/** Путь по маршруту прямых продаж — от заявки до завершения обучения. */
const DIRECT_SALES_PATH = [
  'REQUEST', 'QUALIFICATION', 'OFFER', 'CONTRACT', 'ACCESS_GRANTED', 'LEARNING', 'COMPLETED',
];

const DIRECT_SALES_LABELS = new Map(
  DIRECT_SALES_WORKFLOW_DEFINITION.states.map((state) => [state.key, state.label]),
);

const DIRECT_SALES_COMPANIES = [
  'ООО «Северная логистика»',
  'АО «Промтехресурс»',
  'ООО «Цифровые решения Поволжья»',
  'ООО «Мастерская данных»',
  'АО «Энергосбыт-ИТ»',
];

/**
 * Демонстрационные заявки сегмента B2C.
 *
 * Нужны не для красоты: без них не видно, что отчёты, фильтры и область
 * видимости работают на заявках без вуза, а это самый вероятный источник
 * ошибок после перевода модели на сегменты.
 */
async function seedDirectSalesEngagements(
  directionIds: string[],
  productIds: string[],
  templateId: string,
  ownerIds: string[],
) {
  const existing = await prisma.engagement.count({ where: { segment: 'B2C' } });
  if (existing > 0) {
    console.log(`  Заявки прямых продаж уже созданы (${existing}), пропускаем.`);
    return existing;
  }

  let created = 0;

  for (let i = 0; i < 14; i++) {
    const isCompany = random.chance(0.35);
    const counterpartyName = isCompany
      ? random.pick(DIRECT_SALES_COMPANIES)
      : random.pick(CONTACT_NAMES);

    // Для физического лица заводится запись в каталоге персон: правовое
    // основание обработки — согласие субъекта, а не договор с вузом.
    const contact = isCompany
      ? null
      : await prisma.person.create({
          data: {
            fullName: counterpartyName,
            email: `student${random.int(1000, 9999)}@example.ru`,
            lawfulBasis: 'CONSENT',
          },
        });

    const isRejected = random.chance(0.15);
    const depth = isRejected ? random.int(1, 3) : random.int(1, DIRECT_SALES_PATH.length);
    const path = DIRECT_SALES_PATH.slice(0, depth);
    const finalState = isRejected ? 'REJECTED' : (path[path.length - 1] as string);

    const ownerId = random.pick(ownerIds);
    const createdDaysAgo = random.int(10, 200);

    const engagement = await prisma.engagement.create({
      data: {
        segment: 'B2C',
        counterpartyType: isCompany ? 'COMPANY' : 'PERSON',
        counterpartyName,
        counterpartyContactId: contact?.id ?? null,
        directionId: random.pick(directionIds),
        productId: random.chance(0.6) ? random.pick(productIds) : null,
        ownerId,
        currentStateKey: finalState,
        currentStateLabel: DIRECT_SALES_LABELS.get(finalState) ?? finalState,
        createdAt: daysAgo(createdDaysAgo),
        updatedAt: daysAgo(random.int(1, Math.max(2, createdDaysAgo - 5))),
      },
    });

    const instance = await prisma.workflowInstance.create({
      data: {
        engagementId: engagement.id,
        templateId,
        currentStateKey: finalState,
        enteredAt: daysAgo(random.int(1, 20)),
        completedAt:
          finalState === 'COMPLETED' || finalState === 'REJECTED' ? daysAgo(random.int(1, 15)) : null,
      },
    });

    let transitionDay = createdDaysAgo;
    const fullPath = isRejected ? [...path, 'REJECTED'] : path;

    for (let step = 1; step < fullPath.length; step++) {
      const from = fullPath[step - 1] as string;
      const to = fullPath[step] as string;
      transitionDay = Math.max(1, transitionDay - random.int(3, 20));

      await prisma.workflowTransition.create({
        data: {
          instanceId: instance.id,
          fromStateKey: from,
          fromStateLabel: DIRECT_SALES_LABELS.get(from) ?? from,
          toStateKey: to,
          toStateLabel: DIRECT_SALES_LABELS.get(to) ?? to,
          actorId: ownerId,
          createdAt: daysAgo(transitionDay),
        },
      });
    }

    created++;
  }

  return created;
}

/**
 * Контактные лица вендоров. Заводятся только у вендора, у которого
 * контактов ещё нет: на стенде их могли загрузить из каталога заказчика
 * или добавить вручную, и вымышленный контакт рядом с настоящим не нужен.
 */
async function seedVendorContacts(vendorByName: Map<string, string>, productNamesByVendor: Map<string, string[]>) {
  let created = 0;

  for (const item of VENDOR_CONTACTS) {
    const vendorId = vendorByName.get(item.vendor);
    if (!vendorId) continue;

    const existing = await prisma.vendorContact.count({ where: { vendorId } });
    if (existing > 0) continue;

    const person =
      (await prisma.person.findFirst({ where: { email: item.email, erasedAt: null } })) ??
      (await prisma.person.create({
        data: { fullName: item.fullName, email: item.email, phone: item.phone, lawfulBasis: 'CONTRACT' },
      }));

    await prisma.vendorContact.create({
      data: {
        vendorId,
        personId: person.id,
        channels: item.channels,
        products: productNamesByVendor.get(item.vendor) ?? [],
        isPrimary: true,
      },
    });

    created++;
  }

  return created;
}

/**
 * Оплатившие слушатели, ожидающие выгрузки в LMS.
 *
 * Показывают путь «оплата с сайта → выгрузка в LMS» без обращения к сайту:
 * заявки прямых продаж на этапе «Договор и оплата» с номером заказа,
 * потоком и отметкой об оплате. Один слушатель без почты — чтобы список
 * кандидатов показывал, почему человек не готов к выгрузке.
 */
const PAID_LEARNERS: ReadonlyArray<{
  order: string;
  program: string;
  fullName: string;
  phone: string;
  email: string | null;
  stream: string;
}> = [
  { order: 'ORD-20260903101512-DEMO01', program: 'Инженер-тестировщик', fullName: 'Белова Ксения Андреевна', phone: '+79000000201', email: 'belova.ka@example.ru', stream: '3' },
  { order: 'ORD-20260904153047-DEMO02', program: 'Промпт-инжиниринг', fullName: 'Данилов Артём Игоревич', phone: '+79000000202', email: 'danilov.ai@example.ru', stream: '2' },
  { order: 'ORD-20260908092233-DEMO03', program: 'Анализ данных без программирования', fullName: 'Ефимова Полина Сергеевна', phone: '+79000000203', email: 'efimova.ps@example.ru', stream: '1' },
  { order: 'ORD-20260910184405-DEMO04', program: 'Python-разработчик с использованием инструментов ИИ', fullName: 'Зуев Никита Олегович', phone: '+79000000204', email: null, stream: '4' },
];

async function seedPaidLearners(templateId: string, ownerIds: string[]) {
  const source = await prisma.integrationSource.findFirst({ where: { type: 'WEBSITE' } });
  if (!source) return 0;

  let created = 0;

  for (const item of PAID_LEARNERS) {
    const exists = await prisma.engagement.findUnique({ where: { paymentReference: item.order } });
    if (exists) continue;

    const program = await prisma.itProgram.findFirst({ where: { name: item.program, isActive: true } });
    if (!program) continue;

    const person = await prisma.person.create({
      data: { fullName: item.fullName, email: item.email, phone: item.phone, lawfulBasis: 'CONTRACT' },
    });

    const paidAt = daysAgo(random.int(3, 20));
    const ownerId = random.pick(ownerIds);

    const engagement = await prisma.engagement.create({
      data: {
        segment: 'B2C',
        counterpartyType: 'PERSON',
        counterpartyName: item.fullName,
        counterpartyContactId: person.id,
        directionId: program.directionId,
        programId: program.id,
        productId: program.productId,
        ownerId,
        currentStateKey: 'CONTRACT',
        currentStateLabel: DIRECT_SALES_LABELS.get('CONTRACT') ?? 'CONTRACT',
        externalId: item.order,
        externalSource: source.name,
        paymentReference: item.order,
        paymentConfirmedAt: paidAt,
        studyStream: item.stream,
        createdAt: paidAt,
      },
    });

    await prisma.workflowInstance.create({
      data: { engagementId: engagement.id, templateId, currentStateKey: 'CONTRACT', enteredAt: paidAt },
    });

    await prisma.activityEvent.createMany({
      data: [
        {
          type: 'ENGAGEMENT_CREATED',
          source: 'INTEGRATION',
          engagementId: engagement.id,
          stateKey: 'CONTRACT',
          stateLabel: DIRECT_SALES_LABELS.get('CONTRACT') ?? 'CONTRACT',
          details: { source: source.name, event: 'payment.confirmed' },
          occurredAt: paidAt,
        },
        {
          type: 'PAYMENT_CONFIRMED',
          source: 'INTEGRATION',
          engagementId: engagement.id,
          stateKey: 'CONTRACT',
          stateLabel: DIRECT_SALES_LABELS.get('CONTRACT') ?? 'CONTRACT',
          details: { orderNumber: item.order, stream: item.stream, course: item.program },
          occurredAt: paidAt,
        },
      ],
    });

    created++;
  }

  return created;
}

async function seedContractsAndLicenses(universityIds: string[], productIds: string[]) {
  const existing = await prisma.contract.count();
  if (existing > 0) {
    console.log(`  Договоры уже созданы (${existing}), пропускаем.`);
    return;
  }

  // Договоры заводим примерно у двух третей вузов — остальные ещё
  // не дошли до подписания, что соответствует реальной воронке.
  for (const universityId of universityIds) {
    if (!random.chance(0.65)) continue;

    const signedDaysAgo = random.int(60, 500);
    const contract = await prisma.contract.create({
      data: {
        universityId,
        number: `РТК-${random.int(1000, 9999)}/${new Date().getUTCFullYear() - (signedDaysAgo > 365 ? 1 : 0)}`,
        signedAt: daysAgo(signedDaysAgo),
        comment: random.chance(0.3) ? 'Рамочное соглашение о сотрудничестве' : null,
      },
    });

    const licenseCount = random.int(1, 3);
    for (let i = 0; i < licenseCount; i++) {
      const validYears = random.pick([1, 1, 2, 3]);
      const licenseSigned = daysAgo(signedDaysAgo - random.int(0, 30));
      const validUntil = new Date(licenseSigned);
      validUntil.setUTCFullYear(validUntil.getUTCFullYear() + validYears);

      await prisma.license.create({
        data: {
          contractId: contract.id,
          productId: random.pick(productIds),
          signedAt: licenseSigned,
          validYears,
          validUntil,
          transferStatus: random.pick(['TRANSFERRED', 'TRANSFERRED', 'IN_PROGRESS', 'NOT_STARTED']),
        },
      });
    }
  }
}

// ---------------------------------------------------------------------------
//  Рабочий инструментарий менеджера: оценки, заметки, задачи
// ---------------------------------------------------------------------------

/**
 * Отдельный генератор: добавление этого наполнения не должно сдвигать
 * последовательность основного, иначе на уже наполненной базе и на новой
 * одинаковые по смыслу заявки получили бы разные данные.
 */
const workbenchRandom = createRandom(20260925);

const INTEREST_COMMENTS: Record<'HIGH' | 'MEDIUM' | 'LOW', string[]> = {
  HIGH: [
    'Кафедра готова включить курс в весенний семестр',
    'Проректор по учебной работе лично курирует пилот',
    'Студенты уже просят практику на реальных стендах',
  ],
  MEDIUM: [
    'Интерес есть, но в учебном плане нет свободных часов',
    'Ждут решения по бюджету на следующий год',
    'Готовы начать с факультатива, а не с основной дисциплины',
  ],
  LOW: [
    'Направление не в приоритете у вуза',
    'Уже работают с продуктом другого вендора',
    'Кафедра сокращается, вести курс некому',
  ],
};

const GENERAL_NOTES = [
  'Ректор в отпуске до конца месяца — решения принимает первый проректор',
  'Все документы только через юридический отдел, согласование занимает две недели',
  'Кафедра просит проводить встречи по вторникам после обеда',
  'В приёмной отвечают до 12:00, позже звонить бесполезно',
  'Вуз участвует в программе «Приоритет-2030» — это стоит упоминать в письмах',
];

const STAGE_NOTES: Record<string, string[]> = {
  CONTACT_SEARCH: ['Контакт заведующего кафедрой получен через выпускника, работающего у нас'],
  COMMUNICATION: ['Интересуются практикой на реальных стендах, лекционная часть им менее важна'],
  MEETING: ['Встречу перенесли по просьбе вуза: новая дата — после сессии'],
  DOCUMENTS_EXCHANGE: ['Юристы вуза просят типовую форму лицензионного договора в редактируемом виде'],
  DOCUMENTS_REVISION: ['Правки касаются срока лицензии: вуз хочет три года вместо одного'],
  SIGNING: ['Ректор подписывает только в приёмные дни — понедельник и четверг'],
  MATERIALS_TRANSFER: ['Материалы передаём на носителе: у вуза закрытый контур без выхода в интернет'],
  IMPLEMENTATION: ['Стенд на 30 рабочих мест, нужен доступ администратора сети вуза'],
  TEACHER_TRAINING: ['Преподавателей отпустят на обучение только в каникулы'],
  PROGRAM_UPDATE: ['Рабочую программу утверждает учёный совет, ближайшее заседание — в конце месяца'],
  CLASSES: ['Первый поток — 25 человек, на второй идёт набор'],
  QUALIFICATION: ['Нужен курс под конкретный проект заказчика, стандартная программа не подходит'],
  OFFER: ['Просят рассрочку платежа на три месяца'],
  CONTRACT: ['Оплата от юридического лица — нужен счёт с НДС'],
};

const OWN_TASKS = [
  'Позвонить на кафедру по итогам встречи',
  'Отправить проект договора в юридический отдел вуза',
  'Подготовить презентацию для учёного совета',
  'Согласовать даты обучения преподавателей',
  'Проверить, дошли ли лицензионные ключи',
  'Напомнить вузу о подписании договора',
  'Собрать отзывы преподавателей после первого потока',
  'Сверка по заявкам с руководителем',
];

const ASSIGNED_TASKS = [
  'Подготовить сводку по своим вузам к совещанию',
  'Продвинуть заявки, стоящие без движения больше двух недель',
];

/** Сегодняшняя дата в Москве со сдвигом: YYYY-MM-DD. */
function moscowDate(shiftDays: number): string {
  return addDays(dateInZone(new Date(), 'Europe/Moscow'), shiftDays);
}

/**
 * Оценки заинтересованности, заметки и задачи календаря.
 *
 * Без них экраны, ради которых эти возможности сделаны, на стенде пусты:
 * цветные метки заинтересованности в карточках, заметки на шагах пути,
 * лента «что я делал на этой неделе» и календарь. Наполнение выполняется
 * один раз — при первой выкладке, где заметок и задач ещё нет; после этого
 * работа пользователей не перекрывается демонстрационной.
 */
async function seedWorkbench(managerId: string, kamIds: string[]) {
  const [notes, tasks] = await Promise.all([prisma.engagementNote.count(), prisma.plannerTask.count()]);

  if (notes > 0 || tasks > 0) {
    console.log(`  Заметки и задачи уже есть (${notes} / ${tasks}), пропускаем.`);
    return;
  }

  const engagements = await prisma.engagement.findMany({
    where: { isArchived: false },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      segment: true,
      ownerId: true,
      currentStateKey: true,
      currentStateLabel: true,
      interestLevel: true,
      workflowInstance: {
        select: { transitions: { select: { toStateKey: true, toStateLabel: true } } },
      },
    },
  });

  let rated = 0;
  let noteCount = 0;

  for (const engagement of engagements) {
    // --- Оценка заинтересованности. Чем дальше заявка продвинулась,
    // тем вероятнее высокая оценка; отказ — всегда низкая.
    const depth = MAIN_PATH.indexOf(engagement.currentStateKey);
    const isRejected = engagement.currentStateKey === 'REJECTED';
    const rateChance = engagement.segment === 'B2B' ? 0.75 : 0.4;

    if (engagement.interestLevel === null && workbenchRandom.chance(rateChance)) {
      const level: 'HIGH' | 'MEDIUM' | 'LOW' = isRejected
        ? 'LOW'
        : depth >= 5 || workbenchRandom.chance(0.3)
          ? 'HIGH'
          : workbenchRandom.chance(0.6)
            ? 'MEDIUM'
            : 'LOW';
      const comment = workbenchRandom.chance(0.7) ? workbenchRandom.pick(INTEREST_COMMENTS[level]) : null;
      const at = daysAgo(workbenchRandom.int(1, 25));

      await prisma.engagement.update({
        where: { id: engagement.id },
        data: {
          interestLevel: level,
          interestComment: comment,
          interestUpdatedAt: at,
          interestUpdatedById: engagement.ownerId,
        },
      });

      await prisma.activityEvent.create({
        data: {
          type: 'INTEREST_CHANGED',
          actorId: engagement.ownerId,
          engagementId: engagement.id,
          stateKey: engagement.currentStateKey,
          stateLabel: engagement.currentStateLabel,
          details: { fromLevel: null, toLevel: level, comment },
          occurredAt: at,
        },
      });

      rated++;
    }

    // --- Заметки: у части заявок — к текущему этапу, к пройденному
    // и ко всей заявке целиком.
    if (!workbenchRandom.chance(engagement.segment === 'B2B' ? 0.45 : 0.3)) {
      continue;
    }

    const visited = new Map<string, string>([[engagement.currentStateKey, engagement.currentStateLabel]]);
    for (const transition of engagement.workflowInstance?.transitions ?? []) {
      visited.set(transition.toStateKey, transition.toStateLabel);
    }

    const candidates: Array<{ key: string | null; label: string | null; body: string }> = [];

    for (const [key, label] of visited) {
      for (const body of STAGE_NOTES[key] ?? []) {
        candidates.push({ key, label, body });
      }
    }
    candidates.push({ key: null, label: null, body: workbenchRandom.pick(GENERAL_NOTES) });

    const howMany = workbenchRandom.int(1, Math.min(3, candidates.length));

    for (let index = 0; index < howMany; index++) {
      const picked = candidates.splice(workbenchRandom.int(0, candidates.length - 1), 1)[0];
      if (!picked) break;

      const at = daysAgo(workbenchRandom.int(0, 20));
      const note = await prisma.engagementNote.create({
        data: {
          engagementId: engagement.id,
          authorId: engagement.ownerId,
          body: picked.body,
          stateKey: picked.key,
          stateLabel: picked.label,
          isPinned: picked.key === null && workbenchRandom.chance(0.5),
          createdAt: at,
        },
        select: { id: true },
      });

      await prisma.activityEvent.create({
        data: {
          type: 'NOTE_ADDED',
          actorId: engagement.ownerId,
          engagementId: engagement.id,
          stateKey: picked.key,
          stateLabel: picked.label,
          noteId: note.id,
          occurredAt: at,
        },
      });

      noteCount++;
    }
  }

  // --- Задачи календаря: свои у каждого менеджера и поручения руководителя.
  let taskCount = 0;
  const people = [managerId, ...kamIds];

  const createTask = async (params: {
    ownerId: string;
    createdById: string;
    title: string;
    shift: number;
    time: string | null;
    engagementId: string | null;
    completed: boolean;
    remind: boolean;
  }) => {
    const dueDate = moscowDate(params.shift);
    const dueAt = params.time ? zonedToUtc(dueDate, params.time, 'Europe/Moscow') : null;
    const createdAt = daysAgo(Math.max(1, 3 - params.shift));

    const task = await prisma.plannerTask.create({
      data: {
        ownerId: params.ownerId,
        createdById: params.createdById,
        engagementId: params.engagementId,
        title: params.title,
        dueDate: dateToDb(dueDate),
        dueAt,
        remindAt: params.remind ? zonedToUtc(dueDate, '09:00', 'Europe/Moscow') : null,
        completedAt: params.completed ? daysAgo(0) : null,
        createdAt,
      },
      select: { id: true },
    });

    await prisma.activityEvent.create({
      data: {
        type: 'TASK_CREATED',
        actorId: params.createdById,
        engagementId: params.engagementId,
        taskId: task.id,
        details: {
          dueDate,
          dueTime: params.time,
          ...(params.ownerId !== params.createdById ? { assignedTo: params.ownerId } : {}),
        },
        occurredAt: createdAt,
      },
    });

    if (params.completed) {
      await prisma.activityEvent.create({
        data: {
          type: 'TASK_COMPLETED',
          actorId: params.ownerId,
          engagementId: params.engagementId,
          taskId: task.id,
          details: { dueDate },
        },
      });
    }

    taskCount++;
  };

  for (const personId of people) {
    const own = engagements.filter(
      (engagement) => engagement.ownerId === personId && engagement.currentStateKey !== 'REJECTED',
    );

    // Сдвиги подобраны так, чтобы в календаре было всё сразу: выполненное
    // вчера, просроченное, сегодняшнее, ближайшие дни и дальние сроки.
    const plan = [
      { shift: -3, completed: true, time: null },
      { shift: -1, completed: false, time: null },
      { shift: 0, completed: false, time: '11:00' },
      { shift: 1, completed: false, time: null },
      { shift: 2, completed: false, time: '15:30' },
      { shift: 5, completed: false, time: null },
      { shift: 9, completed: false, time: null },
      { shift: 16, completed: false, time: '10:00' },
    ];

    for (const [index, item] of plan.entries()) {
      await createTask({
        ownerId: personId,
        createdById: personId,
        title: OWN_TASKS[index % OWN_TASKS.length] as string,
        shift: item.shift,
        time: item.time,
        engagementId: own.length > 0 && workbenchRandom.chance(0.7) ? workbenchRandom.pick(own).id : null,
        completed: item.completed,
        remind: item.shift === 1,
      });
    }
  }

  for (const kamId of kamIds) {
    for (const [index, title] of ASSIGNED_TASKS.entries()) {
      await createTask({
        ownerId: kamId,
        createdById: managerId,
        title,
        shift: 3 + index * 4,
        time: null,
        engagementId: null,
        completed: false,
        remind: false,
      });
    }
  }

  console.log(`  Оценки заинтересованности: ${rated}, заметки: ${noteCount}, задачи: ${taskCount}`);
}

// ---------------------------------------------------------------------------
//  Каталог курсов: учебные потоки, встречи, заметки по вузу
// ---------------------------------------------------------------------------

/**
 * Отдельный генератор: новые разделы наполнения не должны сдвигать
 * последовательность основного, иначе на чистой базе заявки получились
 * бы другими, чем на стендах, наполненных раньше.
 */
const catalogRandom = createRandom(20260928);

/** С какого этапа базового процесса у вуза идут занятия и с какого поток уже планируют. */
const CLASSES_FROM = MAIN_PATH.indexOf('CLASSES');
const PLANNING_FROM = MAIN_PATH.indexOf('TEACHER_TRAINING');

/** «Осень-2026», «Зима-2027» — как потоки называют в LMS вузов: по сезону старта. */
function seasonName(date: string): string {
  const [year, month] = date.split('-').map(Number) as [number, number];
  const season =
    month === 12 || month <= 2 ? 'Зима' : month <= 5 ? 'Весна' : month <= 8 ? 'Лето' : 'Осень';
  return `${season}-${year}`;
}

/**
 * Учебные потоки.
 *
 * Потоки при вузе выводятся из заявок: вуз, дошедший до ведения занятий,
 * учит студентов по программе направления заявки, а вуз, готовящий
 * преподавателей, — планирует поток. Программа заявки при этом
 * проставляется, если не была указана: иначе поток и заявка не связаны.
 * Наборы сайта (edu-rt, sz-rt, edupro) — потоки без вуза.
 */
async function seedStreams(): Promise<number> {
  const existing = await prisma.learningStream.count();
  if (existing > 0) {
    console.log(`  Учебные потоки уже созданы (${existing}), пропускаем.`);
    return existing;
  }

  const programs = await prisma.itProgram.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, directionId: true, productId: true, source: true },
  });

  const engagements = await prisma.engagement.findMany({
    where: { segment: 'B2B', isArchived: false, universityId: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      universityId: true,
      directionId: true,
      productId: true,
      programId: true,
      currentStateKey: true,
      updatedAt: true,
    },
  });

  const streams: Array<{
    programId: string;
    universityId: string | null;
    name: string;
    startDate: string;
    endDate: string | null;
    studentsCount: number;
    status: 'PLANNED' | 'ACTIVE' | 'COMPLETED';
  }> = [];

  for (const engagement of engagements) {
    const depth = MAIN_PATH.indexOf(engagement.currentStateKey);
    if (depth < PLANNING_FROM) continue;

    const candidates = programs.filter(
      (program) => program.directionId === engagement.directionId && program.source === 'RTK_SCHOOL',
    );
    if (candidates.length === 0) continue;

    const program =
      candidates.find((item) => item.id === engagement.programId) ??
      candidates.find((item) => item.productId !== null && item.productId === engagement.productId) ??
      catalogRandom.pick(candidates);

    if (engagement.programId === null) {
      // Дата изменения сохраняется: наполнение не должно поднимать
      // давние заявки в списке «недавно изменённых».
      await prisma.engagement.update({
        where: { id: engagement.id },
        data: { programId: program.id, updatedAt: engagement.updatedAt },
      });
    }

    const universityId = engagement.universityId;

    if (depth >= CLASSES_FROM) {
      const start = moscowDate(-catalogRandom.int(20, 110));
      streams.push({
        programId: program.id,
        universityId,
        name: seasonName(start),
        startDate: start,
        endDate: addDays(start, catalogRandom.int(90, 150)),
        studentsCount: catalogRandom.int(18, 60),
        status: 'ACTIVE',
      });

      // Параллельный поток — там, где спрос выше одной группы.
      if (catalogRandom.chance(0.35)) {
        const parallel = addDays(start, catalogRandom.int(0, 14));
        streams.push({
          programId: program.id,
          universityId,
          name: `${seasonName(parallel)}, группа 2`,
          startDate: parallel,
          endDate: addDays(parallel, catalogRandom.int(90, 150)),
          studentsCount: catalogRandom.int(15, 40),
          status: 'ACTIVE',
        });
      }

      // Заявки на сопровождении прошли уже не один поток.
      if (depth > CLASSES_FROM || catalogRandom.chance(0.4)) {
        const past = moscowDate(-catalogRandom.int(240, 330));
        streams.push({
          programId: program.id,
          universityId,
          name: seasonName(past),
          startDate: past,
          endDate: addDays(past, catalogRandom.int(90, 150)),
          studentsCount: catalogRandom.int(20, 55),
          status: 'COMPLETED',
        });
      }
    } else {
      const start = moscowDate(catalogRandom.int(14, 90));
      streams.push({
        programId: program.id,
        universityId,
        name: seasonName(start),
        startDate: start,
        endDate: null,
        studentsCount: catalogRandom.int(15, 45),
        status: 'PLANNED',
      });
    }
  }

  // Наборы сайта: идущий поток и следующий набор.
  for (const program of programs.filter((item) => item.source !== 'RTK_SCHOOL')) {
    const start = moscowDate(-catalogRandom.int(10, 60));
    streams.push({
      programId: program.id,
      universityId: null,
      name: `Поток ${catalogRandom.int(2, 6)}`,
      startDate: start,
      endDate: addDays(start, catalogRandom.int(60, 90)),
      studentsCount: catalogRandom.int(25, 90),
      status: 'ACTIVE',
    });

    if (catalogRandom.chance(0.7)) {
      const next = moscowDate(catalogRandom.int(20, 75));
      streams.push({
        programId: program.id,
        universityId: null,
        name: 'Следующий набор',
        startDate: next,
        endDate: null,
        studentsCount: catalogRandom.int(10, 40),
        status: 'PLANNED',
      });
    }
  }

  await prisma.learningStream.createMany({
    data: streams.map((stream) => ({
      ...stream,
      startDate: dateToDb(stream.startDate),
      endDate: stream.endDate ? dateToDb(stream.endDate) : null,
    })),
  });

  return streams.length;
}

/**
 * Программа у заявок прямых продаж.
 *
 * ТЗ ранжирует программы по числу заявок, а заявки прямых продаж,
 * заведённые наполнением, программы не имели — ранжированию было не на
 * чем показать себя. Заявке подбирается программа её направления,
 * предпочтительно из наборов сайта. Уже указанная программа не меняется.
 */
async function seedApplicationPrograms(): Promise<number> {
  const programs = await prisma.itProgram.findMany({
    where: { isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, directionId: true, source: true },
  });

  const engagements = await prisma.engagement.findMany({
    where: { segment: 'B2C', programId: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, directionId: true, updatedAt: true },
  });

  let updated = 0;

  for (const engagement of engagements) {
    const sameDirection = programs.filter((program) => program.directionId === engagement.directionId);
    const fromSite = sameDirection.filter((program) => program.source !== 'RTK_SCHOOL');
    const candidates = fromSite.length > 0 ? fromSite : sameDirection;
    if (candidates.length === 0) continue;

    await prisma.engagement.update({
      where: { id: engagement.id },
      data: { programId: catalogRandom.pick(candidates).id, updatedAt: engagement.updatedAt },
    });
    updated++;
  }

  return updated;
}

const MEETING_AGENDAS = [
  'Знакомство с кафедрой и презентация программ ИТ Школы РТК',
  'Обсуждение пилота по направлению и состава лицензий',
  'Согласование расписания обучения преподавателей',
  'Разбор требований вуза к договору и срокам',
];

const MEETING_PROTOCOLS = [
  'Вуз заинтересован в пилоте на одной группе; направить проект договора до конца недели',
  'Договорились о составе лицензий и стенде на 30 рабочих мест',
  'Кафедра подготовит список преподавателей для обучения; следующий шаг — документы',
  'Юристы вуза просят типовую форму договора в редактируемом виде',
];

const MEETING_TIMES = ['10:00', '11:30', '14:00', '15:30'];

/**
 * Встречи с представителями вузов.
 *
 * Заявка, прошедшая этап «Организация встречи», получает проведённую
 * встречу с итогами — в пределах срока, пока заявка стояла на этапе.
 * Заявка, стоящая на нём сейчас, — назначенную на ближайшие дни: так
 * встречи видны и в карточке, и в календаре участников.
 */
async function seedMeetings(): Promise<number> {
  const existing = await prisma.engagementMeeting.count();
  if (existing > 0) {
    console.log(`  Встречи уже созданы (${existing}), пропускаем.`);
    return existing;
  }

  const engagements = await prisma.engagement.findMany({
    where: { segment: 'B2B', isArchived: false, universityId: { not: null } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      ownerId: true,
      universityId: true,
      currentStateKey: true,
      currentStateLabel: true,
      workflowInstance: {
        select: { transitions: { orderBy: { createdAt: 'asc' }, select: { toStateKey: true, createdAt: true } } },
      },
    },
  });

  let created = 0;

  for (const engagement of engagements) {
    const transitions = engagement.workflowInstance?.transitions ?? [];
    const enteredMeeting = transitions.find((item) => item.toStateKey === 'MEETING');
    const atMeeting = engagement.currentStateKey === 'MEETING';

    if (!atMeeting && !enteredMeeting) continue;

    const contact = await prisma.universityContact.findFirst({
      where: { universityId: engagement.universityId as string, person: { erasedAt: null } },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      select: { id: true },
    });

    const time = catalogRandom.pick(MEETING_TIMES);
    let scheduledAt: Date;
    let completed: boolean;

    if (atMeeting) {
      scheduledAt = zonedToUtc(moscowDate(catalogRandom.int(1, 12)), time, 'Europe/Moscow');
      completed = false;
    } else {
      const entered = dateInZone((enteredMeeting as { createdAt: Date }).createdAt, 'Europe/Moscow');
      scheduledAt = zonedToUtc(addDays(entered, catalogRandom.int(2, 5)), time, 'Europe/Moscow');
      completed = true;
    }

    const meeting = await prisma.engagementMeeting.create({
      data: {
        engagementId: engagement.id,
        scheduledAt,
        durationMinutes: catalogRandom.pick([45, 60, 90]),
        location: catalogRandom.chance(0.5) ? 'Видеовстреча' : 'Кафедра, переговорная',
        agenda: catalogRandom.pick(MEETING_AGENDAS),
        protocol: completed ? catalogRandom.pick(MEETING_PROTOCOLS) : null,
        status: completed ? 'COMPLETED' : 'SCHEDULED',
        attendeeIds: [engagement.ownerId],
        contactIds: contact ? [contact.id] : [],
        createdById: engagement.ownerId,
        createdAt: completed ? new Date(scheduledAt.getTime() - 2 * 86_400_000) : daysAgo(catalogRandom.int(1, 3)),
      },
    });

    const when = {
      meetingId: meeting.id,
      date: dateInZone(scheduledAt, 'Europe/Moscow'),
      time: timeInZone(scheduledAt, 'Europe/Moscow'),
    };

    await prisma.activityEvent.createMany({
      data: [
        {
          type: 'MEETING_SCHEDULED',
          actorId: engagement.ownerId,
          engagementId: engagement.id,
          stateKey: 'MEETING',
          stateLabel: STATE_LABELS.get('MEETING') ?? 'MEETING',
          details: { ...when, status: 'SCHEDULED' },
          occurredAt: meeting.createdAt,
        },
        ...(completed
          ? [
              {
                type: 'MEETING_UPDATED' as const,
                actorId: engagement.ownerId,
                engagementId: engagement.id,
                stateKey: 'MEETING',
                stateLabel: STATE_LABELS.get('MEETING') ?? 'MEETING',
                details: { ...when, status: 'COMPLETED', changed: ['status', 'protocol'] },
                occurredAt: new Date(scheduledAt.getTime() + 2 * 3_600_000),
              },
            ]
          : []),
      ],
    });

    created++;
  }

  return created;
}

const UNIVERSITY_NOTES: ReadonlyArray<{ body: string; pinned: boolean }> = [
  { body: 'Сменился проректор по цифровизации — прежние договорённости подтвердить заново', pinned: true },
  { body: 'Закупки только через электронную площадку, от объявления до договора — около 30 дней', pinned: true },
  { body: 'Кафедра ИТ готова быть базовой площадкой для пилотов по всем направлениям', pinned: false },
  { body: 'Визиты согласовываются за неделю через приёмную ректора', pinned: false },
  { body: 'В следующем учебном году вуз открывает направление «Кибербезопасность» — предложить программы ИБ', pinned: false },
  { body: 'Контакты кафедр обновлены после реорганизации института информационных технологий', pinned: false },
];

/**
 * Заметки по вузу — у части вузов, с которыми идёт работа. Автор —
 * ответственный по первой заявке вуза: он и знает вуз лучше других.
 */
async function seedUniversityNotes(): Promise<number> {
  const existing = await prisma.universityNote.count();
  if (existing > 0) {
    console.log(`  Заметки по вузам уже созданы (${existing}), пропускаем.`);
    return existing;
  }

  const universities = await prisma.university.findMany({
    where: { isActive: true, engagements: { some: { isArchived: false } } },
    orderBy: { name: 'asc' },
    select: {
      id: true,
      engagements: { where: { isArchived: false }, orderBy: { createdAt: 'asc' }, take: 1, select: { ownerId: true } },
    },
  });

  let created = 0;

  for (const university of universities) {
    const authorId = university.engagements[0]?.ownerId;
    if (!authorId || !catalogRandom.chance(0.45)) continue;

    const count = catalogRandom.int(1, 2);
    for (let i = 0; i < count; i++) {
      const note = catalogRandom.pick(UNIVERSITY_NOTES);
      await prisma.universityNote.create({
        data: {
          universityId: university.id,
          authorId,
          body: note.body,
          isPinned: note.pinned && i === 0,
          createdAt: daysAgo(catalogRandom.int(3, 120)),
        },
      });
      created++;
    }
  }

  return created;
}

/** Линейный процесс: каждый этап ведёт в следующий. */
function linearProcess(
  states: ReadonlyArray<{ key: string; label: string; slaDays?: number; transition: string }>,
): object {
  return {
    states: states.map((state, index) => ({
      key: state.key,
      label: state.label,
      order: index,
      isInitial: index === 0,
      isFinal: index === states.length - 1,
      ...(state.slaDays ? { slaDays: state.slaDays } : {}),
      requiresAttachment: false,
    })),
    transitions: states.slice(1).map((state, index) => ({
      from: (states[index] as { key: string }).key,
      to: state.key,
      label: state.transition,
      requiresComment: false,
      allowedRoles: [],
    })),
  };
}

/**
 * Процессы проектов sz-rt и edu-rt — черновиками.
 *
 * Процесс сегмента один на всех, и публикация переводит на него все
 * заявки сегмента. Поэтому процессы проектов заводятся неопубликованными:
 * администратор видит их в редакторе и решает, публиковать ли.
 */
async function seedProjectProcesses(): Promise<number> {
  const processes = [
    {
      key: 'sz-rt-aktivnye-mery',
      name: 'Активные меры · sz-rt',
      description: 'Федеральный проект «Активные меры содействия занятости»: запись, ЦЗН, договор, обучение',
      segment: 'B2C' as const,
      siteSource: 'SZ_RT' as const,
      definition: linearProcess([
        { key: 'APPLICATION', label: 'Заявка на обучение', slaDays: 1, transition: 'Заявка принята' },
        { key: 'WORK_RU_CONFIRM', label: 'Подтверждение заявки в «Работе России»', slaDays: 7, transition: 'Заявка подтверждена' },
        { key: 'CAREER_GUIDANCE', label: 'Профориентация в ЦЗН', slaDays: 3, transition: 'Профориентация пройдена' },
        { key: 'EMPLOYER_CONSENT', label: 'Согласие работодателя на договор', slaDays: 3, transition: 'Согласие получено' },
        { key: 'TRIPARTITE_CONTRACT', label: 'Трёхсторонний договор', slaDays: 2, transition: 'Договор подписан' },
        { key: 'ENROLLMENT_DOCS', label: 'Документы на зачисление', slaDays: 2, transition: 'Документы собраны' },
        { key: 'TRAINING', label: 'Обучение (поток, формат ДОТ)', slaDays: 30, transition: 'Зачислен в поток' },
        { key: 'JOB_OR_DIPLOMA', label: 'Трудоустройство и документ', transition: 'Обучение завершено' },
      ]),
    },
    {
      key: 'edu-rt-lms',
      name: 'LMS и кадровый резерв · edu-rt',
      description: 'Коммерческие программы для организаций: интеграция LMS, обучение, кадровый резерв',
      segment: 'B2B' as const,
      siteSource: 'EDU_RT' as const,
      definition: linearProcess([
        { key: 'CONSULTATION', label: 'Консультация и подбор программы', slaDays: 2, transition: 'Программа подобрана' },
        { key: 'LMS_INTEGRATION', label: 'Интеграция LMS', slaDays: 5, transition: 'LMS подключена' },
        { key: 'CONTRACT', label: 'Договор с организацией', slaDays: 3, transition: 'Договор подписан' },
        { key: 'STREAM_ONBOARD', label: 'Зачисление потока и доступы', slaDays: 2, transition: 'Доступы выданы' },
        { key: 'TRAINING', label: 'Обучение и промежуточная аттестация', slaDays: 30, transition: 'Обучение начато' },
        { key: 'ATTESTATION', label: 'Итоговая аттестация', slaDays: 7, transition: 'Аттестация пройдена' },
        { key: 'RESERVE_SUPPORT', label: 'Кадровый резерв и сопровождение', transition: 'Передан в кадровый резерв' },
      ]),
    },
  ];

  let created = 0;

  for (const process of processes) {
    const exists = await prisma.workflowTemplate.count({ where: { key: process.key } });
    if (exists > 0) continue;

    await prisma.workflowTemplate.create({
      data: {
        key: process.key,
        version: 1,
        name: process.name,
        description: process.description,
        segment: process.segment,
        siteSource: process.siteSource,
        definition: process.definition,
        isActive: false,
        isDefault: false,
      },
    });
    created++;
  }

  return created;
}

// ---------------------------------------------------------------------------
//  Уведомления и документы этапов
// ---------------------------------------------------------------------------

/**
 * Уведомления внутри системы: напоминания о заявках без движения и задачи,
 * поставленные руководителем.
 *
 * На стенде их создают сами сервисы — ночной проход по зависшим заявкам
 * и постановка задачи подчинённому. Наполнение повторяет оба источника теми
 * же текстами и ключами повтора: экран уведомлений не пуст с первого входа,
 * а первый прогон планировщика после наполнения не продублирует напоминания.
 */
async function seedNotifications(): Promise<number> {
  const existing = await prisma.notification.count();
  if (existing > 0) {
    console.log(`  Уведомления уже есть (${existing}), пропускаем.`);
    return existing;
  }

  const policy = await prisma.notificationPolicy.findUnique({ where: { id: 1 } });
  const escalationDays = policy?.escalationDays ?? 14;
  const notifyManager = policy?.notifyManagerOnEscalation ?? true;
  const dayMs = 24 * 60 * 60 * 1000;
  const now = Date.now();

  const rows: Array<{
    userId: string;
    subject: string;
    body: string;
    entityType: string;
    entityId: string;
    dedupeKey: string | null;
    createdAt: Date;
  }> = [];

  const stale = await prisma.engagement.findMany({
    where: {
      isArchived: false,
      owner: { isActive: true },
      workflowInstance: { completedAt: null, enteredAt: { lte: new Date(now - escalationDays * dayMs) } },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      counterpartyName: true,
      currentStateKey: true,
      currentStateLabel: true,
      ownerId: true,
      university: { select: { name: true } },
      owner: { select: { displayName: true, managerId: true } },
      workflowInstance: { select: { enteredAt: true } },
    },
  });

  for (const engagement of stale) {
    const enteredAt = engagement.workflowInstance?.enteredAt;
    if (!enteredAt) continue;

    const summary = {
      id: engagement.id,
      counterpartyName: engagement.university?.name ?? engagement.counterpartyName ?? 'заявка',
      stateLabel: engagement.currentStateLabel,
    };
    // Напоминание приходит, как только простой превысил порог, — с тем
    // числом дней, которое назвал бы первый прогон после этого момента.
    const createdAt = new Date(enteredAt.getTime() + escalationDays * dayMs);
    // Канал к ключу добавляет служба отправки — здесь так же.
    const dedupeKey = (userId: string) =>
      `${escalationDedupeKey({ engagementId: engagement.id, stateKey: engagement.currentStateKey, enteredAt, userId })}:IN_APP`;

    rows.push({
      userId: engagement.ownerId,
      ...buildEscalationText(summary, escalationDays),
      entityType: 'Engagement',
      entityId: engagement.id,
      dedupeKey: dedupeKey(engagement.ownerId),
      createdAt,
    });

    const managerId = engagement.owner.managerId;
    if (notifyManager && managerId && managerId !== engagement.ownerId) {
      rows.push({
        userId: managerId,
        ...buildEscalationForManagerText(summary, escalationDays, engagement.owner.displayName),
        entityType: 'Engagement',
        entityId: engagement.id,
        dedupeKey: dedupeKey(managerId),
        createdAt,
      });
    }
  }

  const tasks = await prisma.plannerTask.findMany({
    where: { deletedAt: null, createdById: { not: null } },
    select: {
      id: true,
      title: true,
      dueDate: true,
      dueAt: true,
      ownerId: true,
      createdById: true,
      createdAt: true,
      createdBy: { select: { displayName: true } },
      engagement: { select: { counterpartyName: true, university: { select: { name: true } } } },
    },
  });

  for (const task of tasks) {
    if (!task.createdBy || task.createdById === task.ownerId) continue;

    const text = buildTaskAssignedText(
      {
        id: task.id,
        title: task.title,
        dueDate: dateFromDb(task.dueDate),
        dueTime: task.dueAt ? timeInZone(task.dueAt, 'Europe/Moscow') : null,
        counterpartyName: task.engagement
          ? (task.engagement.university?.name ?? task.engagement.counterpartyName ?? null)
          : null,
      },
      task.createdBy.displayName,
    );

    rows.push({
      userId: task.ownerId,
      ...text,
      entityType: 'Task',
      entityId: task.id,
      dedupeKey: null,
      createdAt: task.createdAt,
    });
  }

  // Старше двух суток — прочитано: на экране есть и новые, и прочитанные.
  await prisma.notification.createMany({
    data: rows.map((row) => ({
      ...row,
      channel: 'IN_APP' as const,
      sentAt: row.createdAt,
      readAt: now - row.createdAt.getTime() > 2 * dayMs ? new Date(row.createdAt.getTime() + 3 * 60 * 60 * 1000) : null,
    })),
  });

  return rows.length;
}

/** Свой генератор — по той же причине, что и у каталога курсов. */
const documentsRandom = createRandom(20260929);

/** Что прикладывают на этапах, из которых без документа не выйти. */
const STAGE_DOCUMENTS: Record<string, { fileName: string; title: string }> = {
  DOCUMENTS_EXCHANGE: { fileName: 'Проект договора и реквизиты.pdf', title: 'Проект договора и реквизиты сторон' },
  SIGNING: { fileName: 'Договор, подписанный сторонами.pdf', title: 'Договор о сотрудничестве' },
  MATERIALS_TRANSFER: { fileName: 'Акт передачи материалов.pdf', title: 'Акт передачи материалов и лицензий' },
  CONTRACT: { fileName: 'Договор и подтверждение оплаты.pdf', title: 'Договор на обучение и подтверждение оплаты' },
};

/** Минимальное описание API pdfmake 0.3 — как в формирователе отчётов. */
interface SeedPdfMake {
  setFonts(fonts: Record<string, Record<string, string>>): void;
  setLocalAccessPolicy(callback: (path: string) => boolean): void;
  setUrlAccessPolicy(callback: (url: string) => boolean): void;
  createPdf(definition: unknown): {
    getStream(): Promise<NodeJS.ReadableStream & { end(): void }>;
  };
}

async function preparePdfMake(): Promise<SeedPdfMake> {
  const module = await import('pdfmake');
  const pdfMake = (module.default ?? module) as unknown as SeedPdfMake;
  const require = createRequire(import.meta.url);
  const fontsDir = path.join(path.dirname(require.resolve('pdfmake/package.json')), 'fonts', 'Roboto');

  // Встроенные шрифты PDF кириллицы не содержат.
  pdfMake.setFonts({
    Roboto: {
      normal: path.join(fontsDir, 'Roboto-Regular.ttf'),
      bold: path.join(fontsDir, 'Roboto-Medium.ttf'),
      italics: path.join(fontsDir, 'Roboto-Italic.ttf'),
      bolditalics: path.join(fontsDir, 'Roboto-MediumItalic.ttf'),
    },
  });
  pdfMake.setLocalAccessPolicy((filePath) => filePath.startsWith(fontsDir));
  pdfMake.setUrlAccessPolicy(() => false);

  return pdfMake;
}

async function renderStageDocument(
  pdfMake: SeedPdfMake,
  lines: { title: string; counterparty: string; stage: string; date: Date; owner: string },
): Promise<Buffer> {
  const source = await pdfMake
    .createPdf({
      pageSize: 'A4',
      defaultStyle: { font: 'Roboto', fontSize: 11 },
      content: [
        { text: lines.title, fontSize: 16, bold: true, margin: [0, 0, 0, 14] },
        { text: `Контрагент: ${lines.counterparty}` },
        { text: `Этап: ${lines.stage}` },
        { text: `Дата: ${lines.date.toLocaleDateString('ru-RU', { timeZone: 'Europe/Moscow' })}` },
        { text: `Ответственный: ${lines.owner}`, margin: [0, 0, 0, 18] },
        {
          text: 'Демонстрационный документ: сформирован при наполнении базы и юридической силы не имеет.',
          fontSize: 9,
          color: '#777777',
        },
      ],
    })
    .getStream();

  // Документ pdfmake финализируется только вызовом end() — как в отчётах.
  const chunks: Buffer[] = [];
  const done = new Promise<void>((resolve, reject) => {
    source.on('data', (chunk: Buffer) => chunks.push(chunk));
    source.on('end', () => resolve());
    source.on('error', reject);
  });
  source.end();
  await done;

  return Buffer.concat(chunks);
}

/**
 * Файлы на этапах, из которых без документа не выйти.
 *
 * Заявки наполнения проходят эти этапы переходами из журнала, минуя загрузку,
 * и без файлов противоречили бы собственному процессу, а реестр документов
 * и вкладка файлов в карточке пустовали бы. Файл — короткий PDF с пометкой
 * о демонстрационном характере; он кладётся в то же хранилище, что и
 * загрузки пользователей, иначе скачать его было бы нельзя.
 *
 * Статус проверки — «проверен»: содержимое собрано здесь же из фиксированного
 * текста, угрозы, от которой защищает антивирус, в нём нет. Иначе заявки
 * наполнения нельзя было бы открыть КАМу — выдачу непроверенных файлов
 * сервис разрешает только администратору.
 *
 * Без настроенного хранилища (S3_*) шаг пропускается: запись без объекта
 * в хранилище хуже, чем её отсутствие.
 */
async function seedStageDocuments(): Promise<number> {
  const existing = await prisma.attachment.count();
  if (existing > 0) {
    console.log(`  Файлы этапов уже есть (${existing}), пропускаем.`);
    return existing;
  }

  const { S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY } = process.env;
  if (!S3_ENDPOINT || !S3_ACCESS_KEY || !S3_SECRET_KEY) {
    console.log('  Файлы этапов: хранилище не настроено (S3_ENDPOINT и ключи), пропускаем.');
    return 0;
  }

  const bucket = process.env.S3_BUCKET_ATTACHMENTS ?? 'crm-attachments';
  const encryption = process.env.S3_SERVER_SIDE_ENCRYPTION;
  const s3 = new S3Client({
    endpoint: S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: { accessKeyId: S3_ACCESS_KEY, secretAccessKey: S3_SECRET_KEY },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
  });

  const requiredStages = new Set(
    [...BASE_WORKFLOW_DEFINITION.states, ...DIRECT_SALES_WORKFLOW_DEFINITION.states]
      .filter((state) => state.requiresAttachment)
      .map((state) => state.key),
  );

  const engagements = await prisma.engagement.findMany({
    where: { isArchived: false },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      counterpartyName: true,
      currentStateKey: true,
      university: { select: { name: true } },
      owner: { select: { id: true, displayName: true } },
      workflowInstance: {
        select: {
          transitions: {
            orderBy: { createdAt: 'asc' },
            select: { toStateKey: true, toStateLabel: true, createdAt: true },
          },
        },
      },
    },
  });

  const pdfMake = await preparePdfMake();
  let created = 0;

  for (const engagement of engagements) {
    const transitions = engagement.workflowInstance?.transitions ?? [];

    for (const [index, transition] of transitions.entries()) {
      if (!requiredStages.has(transition.toStateKey)) continue;

      // Этап пройден — документ обязателен; этап текущий — файл приложен
      // не у всех: работа ещё идёт.
      const next = transitions[index + 1];
      if (!next && !documentsRandom.chance(0.5)) continue;

      const until = next?.createdAt.getTime() ?? Date.now();
      const uploadedAt = new Date(
        transition.createdAt.getTime() + Math.floor((until - transition.createdAt.getTime()) * 0.6),
      );
      const document = STAGE_DOCUMENTS[transition.toStateKey] ?? {
        fileName: `${transition.toStateLabel}.pdf`,
        title: transition.toStateLabel,
      };
      const counterparty = engagement.university?.name ?? engagement.counterpartyName ?? 'Контрагент';

      const content = await renderStageDocument(pdfMake, {
        title: document.title,
        counterparty,
        stage: transition.toStateLabel,
        date: uploadedAt,
        owner: engagement.owner.displayName,
      });
      const storageKey = `engagements/${engagement.id}/${randomUUID()}.pdf`;

      try {
        await s3.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: storageKey,
            Body: content,
            ContentType: 'application/pdf',
            ...(encryption === 'AES256' ? { ServerSideEncryption: 'AES256' as const } : {}),
          }),
        );
      } catch (error: unknown) {
        console.log(`  Файлы этапов: хранилище недоступно (${String(error)}), остановлено на ${created}.`);
        return created;
      }

      await prisma.attachment.create({
        data: {
          entityType: 'ENGAGEMENT',
          entityId: engagement.id,
          fileName: document.fileName,
          mimeType: 'application/pdf',
          sizeBytes: BigInt(content.length),
          sha256: createHash('sha256').update(content).digest('hex'),
          storageKey,
          scanStatus: 'CLEAN',
          uploadedById: engagement.owner.id,
          stateKey: transition.toStateKey,
          stateLabel: transition.toStateLabel,
          createdAt: uploadedAt,
        },
      });
      created++;
    }
  }

  return created;
}

async function main() {
  console.log('Наполнение демонстрационными данными...');

  const { manager, kams } = await seedUsers();
  console.log(`  Пользователи: руководитель + ${kams.length} менеджера`);

  const { vendorByName, productByName, directionByCode, universityIds } = await seedCatalogs();
  console.log(`  Каталоги: ${VENDORS.length} вендоров, ${PRODUCTS.length} продуктов, ${DIRECTIONS.length} направлений, ${PROGRAMS.length} программ`);
  console.log(`  Вузы: ${universityIds.length}`);

  const templates = await seedWorkflowTemplate();
  console.log(`  Шаблон B2B: ${BASE_WORKFLOW_DEFINITION.states.length} состояний, ${BASE_WORKFLOW_DEFINITION.transitions.length} переходов`);
  console.log(`  Шаблон B2C: ${DIRECT_SALES_WORKFLOW_DEFINITION.states.length} состояний, ${DIRECT_SALES_WORKFLOW_DEFINITION.transitions.length} переходов`);

  await seedContacts(universityIds);
  const contactCount = await prisma.universityContact.count();
  console.log(`  Контактные лица вузов: ${contactCount}`);

  const ownerIds = [manager.id, ...kams.map((kam) => kam.id)];
  const engagements = await seedEngagements(
    universityIds,
    [...directionByCode.values()],
    [...productByName.values()],
    templates.b2b.id,
    ownerIds,
  );
  console.log(`  Взаимодействия с вузами: ${engagements}`);

  const directSales = await seedDirectSalesEngagements(
    [...directionByCode.values()],
    [...productByName.values()],
    templates.b2c.id,
    ownerIds,
  );
  console.log(`  Заявки прямых продаж: ${directSales}`);

  const sources = await seedIntegrationSources();
  console.log(`  Источники интеграции: ${sources}`);

  const productNamesByVendor = new Map<string, string[]>();
  for (const item of PRODUCTS) {
    productNamesByVendor.set(item.vendor, [...(productNamesByVendor.get(item.vendor) ?? []), item.name]);
  }
  const vendorContacts = await seedVendorContacts(vendorByName, productNamesByVendor);
  console.log(`  Контактные лица вендоров: добавлено ${vendorContacts}`);

  const paidLearners = await seedPaidLearners(templates.b2c.id, kams.map((kam) => kam.id));
  console.log(`  Оплатившие слушатели, ожидающие выгрузки в LMS: добавлено ${paidLearners}`);

  await seedContractsAndLicenses(universityIds, [...productByName.values()]);
  const contracts = await prisma.contract.count();
  const licenses = await prisma.license.count();
  const transitions = await prisma.workflowTransition.count();
  console.log(`  Договоры: ${contracts}, лицензии: ${licenses}`);
  console.log(`  Записей в журнале переходов: ${transitions}`);

  await seedWorkbench(manager.id, kams.map((kam) => kam.id));

  const applicationPrograms = await seedApplicationPrograms();
  console.log(`  Программа у заявок прямых продаж: проставлена ${applicationPrograms}`);

  const streams = await seedStreams();
  console.log(`  Учебные потоки: ${streams}`);

  const meetings = await seedMeetings();
  console.log(`  Встречи с вузами: ${meetings}`);

  const universityNotes = await seedUniversityNotes();
  console.log(`  Заметки по вузам: ${universityNotes}`);

  const projectProcesses = await seedProjectProcesses();
  console.log(`  Процессы проектов sz-rt и edu-rt (черновики): добавлено ${projectProcesses}`);

  const notifications = await seedNotifications();
  console.log(`  Уведомления: ${notifications}`);

  const stageDocuments = await seedStageDocuments();
  console.log(`  Файлы этапов: ${stageDocuments}`);

  // История переходов и вложений переносится в ленту действий той же
  // функцией, что и в миграции: на новой базе миграция выполняется до
  // наполнения и переносить ей было нечего. Повторный вызов ничего
  // не дублирует.
  const [{ backfilled }] = await prisma.$queryRaw<Array<{ backfilled: number }>>`
    SELECT backfill_activity_events() AS backfilled
  `;
  const activity = await prisma.activityEvent.count();
  console.log(`  Лента действий: ${activity} событий, перенесено сейчас: ${backfilled}`);

  console.log('Готово.');
}

main()
  .catch((error: unknown) => {
    console.error('Ошибка наполнения данными:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

/**
 * Имитатор внешних систем ИТ Школы: LMS и сайта.
 *
 * Доступа к настоящим системам заказчик не даёт — обе в переработке,
 * а контур стенда закрытый. Без чего-то на их месте двусторонний обмен
 * показать нечем: встроенные в CRM заглушки доказывают работу кода,
 * но не работу обмена по сети.
 *
 * Поэтому здесь поднимается отдельная служба, которая ведёт себя как
 * внешняя система: отдаёт события по запросу, принимает состояние заявок
 * и умеет сама постучаться в CRM подписанным вызовом. Когда заказчик
 * передаст контракт, служба заменяется настоящим адресом в настройках —
 * код CRM при этом не меняется.
 *
 * Две системы — два порта, как и в реальном контуре, где наружу разрешён
 * «жёсткий точка-точка с конкретными портами».
 *
 * Запуск: node mock-external/server.mjs
 */
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';

const LMS_PORT = Number(process.env.MOCK_LMS_PORT ?? 4010);
const SITE_PORT = Number(process.env.MOCK_SITE_PORT ?? 4011);
const CRM_BASE_URL = process.env.CRM_BASE_URL ?? 'http://api:3000';
const WEBHOOK_SECRET = process.env.INTEGRATION_WEBHOOK_SECRET ?? '';

/** Счётчик для идентификаторов событий: они обязаны быть уникальными. */
let sequence = Date.now() % 100000;

const nextId = (prefix) => `${prefix}-${++sequence}`;

/**
 * Состояние систем.
 *
 * Хранится в памяти: имитатор нужен для показа обмена, а не для хранения
 * данных. Перезапуск возвращает исходный набор — это удобно при повторных
 * демонстрациях.
 */
const state = {
  lms: {
    /** Что CRM ещё не забирала. */
    pending: [
      {
        contract: 'inbound.v1',
        event: 'enrollment.created',
        externalId: 'lms-enroll-90001',
        caseId: 'lms-case-5001',
        occurredAt: '2026-09-15T06:00:00.000Z',
        counterparty: {
          type: 'PERSON',
          name: 'Сидорова Анна Владимировна',
          email: 'a.sidorova@example.ru',
        },
        directionCode: 'DATA',
      },
      {
        contract: 'inbound.v1',
        event: 'enrollment.completed',
        externalId: 'lms-enroll-90002',
        caseId: 'lms-case-5001',
        occurredAt: '2026-09-16T05:30:00.000Z',
        counterparty: {
          type: 'PERSON',
          name: 'Сидорова Анна Владимировна',
          email: 'a.sidorova@example.ru',
        },
        directionCode: 'DATA',
      },
    ],
    /** Что CRM прислала нам. */
    received: [],
  },
  site: {
    pending: [
      {
        contract: 'inbound.v1',
        event: 'request.created',
        externalId: 'site-form-90101',
        caseId: 'site-case-7101',
        occurredAt: '2026-09-14T07:20:00.000Z',
        counterparty: {
          type: 'PERSON',
          name: 'Петров Пётр Петрович',
          email: 'p.petrov@example.ru',
        },
        directionCode: 'DEVOPS',
        comment: 'Заявка с формы на сайте ИТ Школы',
      },
      {
        contract: 'inbound.v1',
        event: 'request.created',
        externalId: 'site-form-90102',
        caseId: 'site-case-7102',
        occurredAt: '2026-09-15T11:05:00.000Z',
        counterparty: {
          type: 'COMPANY',
          name: 'ООО «Северная логистика»',
          email: 'hr@severlog.example.ru',
        },
        directionCode: 'QA',
        comment: 'Корпоративное обучение группы из шести человек',
      },
    ],
    received: [],
  },
};

/** Имена направлений для генерации новых обращений. */
const DIRECTIONS = ['DEVOPS', 'QA', 'DATA', 'INFOSEC', 'CLOUD'];
const NAMES = [
  'Кузнецов Дмитрий Игоревич',
  'Смирнова Ольга Павловна',
  'Волков Артём Сергеевич',
  'Зайцева Екатерина Львовна',
];

function jsonResponse(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Отправляет событие в CRM подписанным вызовом.
 *
 * Это вторая половина входящего направления: внешняя система не ждёт,
 * когда её опросят, а сообщает о событии сама. Подпись считается тем же
 * общим секретом, что проверяет CRM.
 */
async function pushToCrm(system, event) {
  const path = system === 'lms' ? '/api/v1/integration/lms/events' : '/api/v1/integration/website/events';
  const body = JSON.stringify(event);
  const headers = { 'content-type': 'application/json' };

  if (WEBHOOK_SECRET) {
    headers['x-signature'] = createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  }

  const response = await fetch(`${CRM_BASE_URL}${path}`, { method: 'POST', headers, body });
  const text = await response.text();

  return { status: response.status, body: text.slice(0, 500) };
}

/** Новое обращение: им демонстрируется приём событий вживую. */
function buildEvent(system) {
  const name = NAMES[Math.floor(Math.random() * NAMES.length)];
  const direction = DIRECTIONS[Math.floor(Math.random() * DIRECTIONS.length)];
  const caseId = nextId(system === 'lms' ? 'lms-case' : 'site-case');

  return {
    contract: 'inbound.v1',
    event: system === 'lms' ? 'enrollment.created' : 'request.created',
    externalId: nextId(system === 'lms' ? 'lms-enroll' : 'site-form'),
    caseId,
    occurredAt: new Date().toISOString(),
    counterparty: {
      type: 'PERSON',
      name,
      email: `${caseId}@example.ru`,
    },
    directionCode: direction,
    comment: system === 'lms' ? undefined : 'Обращение, созданное имитатором сайта',
  };
}

/**
 * Обработчик одной из двух систем.
 *
 * Набор ручек повторяет контракт, объявленный CRM: выборка событий
 * по курсору, приём состояния заявки и служебные методы для показа.
 */
function createHandler(system, title) {
  return async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const store = state[system];

    // Обращения печатаются в журнал: на демонстрации по нему видно, что CRM
    // действительно ходит в систему по сети, а не работает с заглушкой
    // внутри себя.
    if (url.pathname !== '/health') {
      console.log(`[${system}] ${req.method} ${url.pathname}${url.search}`);
    }

    // --- Что отдаёт система по запросу CRM ---------------------------------
    if (req.method === 'GET' && url.pathname === '/api/crm/events') {
      const since = Number(url.searchParams.get('since') ?? 0);
      const offset = Number.isFinite(since) && since > 0 ? since : 0;
      const events = store.pending.slice(offset);

      return jsonResponse(res, 200, {
        events,
        cursor: String(offset + events.length),
      });
    }

    // --- Что система принимает от CRM --------------------------------------
    if (req.method === 'POST' && url.pathname === '/api/crm/engagements') {
      const raw = await readBody(req);

      try {
        const payload = JSON.parse(raw);
        store.received.push({ receivedAt: new Date().toISOString(), payload });
        // Хранится ограниченное число сообщений: имитатор не журнал.
        if (store.received.length > 100) store.received.shift();

        return jsonResponse(res, 200, { accepted: true, contract: payload.contract });
      } catch {
        return jsonResponse(res, 400, { accepted: false, detail: 'Тело не является JSON' });
      }
    }

    // --- Служебное: посмотреть, что пришло от CRM ---------------------------
    if (req.method === 'GET' && url.pathname === '/api/crm/received') {
      return jsonResponse(res, 200, { count: store.received.length, messages: store.received });
    }

    // --- Служебное: создать новое обращение --------------------------------
    //
    // Без ожидания опроса: событие сразу уходит в CRM подписанным вызовом,
    // и на демонстрации заявка появляется в интерфейсе за секунду.
    if (req.method === 'POST' && url.pathname === '/api/crm/emit') {
      const event = buildEvent(system);
      store.pending.push(event);

      let delivery = { status: 0, body: 'CRM не вызывалась' };
      try {
        delivery = await pushToCrm(system, event);
      } catch (error) {
        delivery = { status: 0, body: String(error) };
      }

      return jsonResponse(res, 200, { event, delivery });
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return jsonResponse(res, 200, {
        system: title,
        pendingEvents: store.pending.length,
        receivedFromCrm: store.received.length,
        endpoints: {
          'GET /api/crm/events?since=': 'события для CRM',
          'POST /api/crm/engagements': 'приём состояния заявки от CRM',
          'GET /api/crm/received': 'что CRM прислала',
          'POST /api/crm/emit': 'создать обращение и сразу отправить в CRM',
        },
      });
    }

    return jsonResponse(res, 404, { detail: 'Метод не поддерживается имитатором' });
  };
}

createServer(createHandler('lms', 'Имитатор LMS ИТ Школы')).listen(LMS_PORT, () => {
  console.log(`Имитатор LMS слушает порт ${LMS_PORT}`);
});

createServer(createHandler('site', 'Имитатор сайта ИТ Школы')).listen(SITE_PORT, () => {
  console.log(`Имитатор сайта слушает порт ${SITE_PORT}`);
  console.log(`CRM для обратных вызовов: ${CRM_BASE_URL}`);
  console.log(`Подпись вызовов: ${WEBHOOK_SECRET ? 'включена' : 'выключена (секрет не задан)'}`);
});

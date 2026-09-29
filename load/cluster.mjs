/**
 * Несколько экземпляров API на одном порту — для замера масштабирования.
 *
 * На стенде экземпляры стоят за балансировщиком (Caddy). Здесь роль
 * балансировщика играет основной процесс модуля cluster: он принимает
 * соединения и раздаёт их экземплярам по кругу, как балансировщик
 * четвёртого уровня. Каждый экземпляр — обычный dist/main.js со своим
 * пулом соединений с базой и своим потоком выполнения, то есть ровно то,
 * что получается при `docker compose up --scale api=N`.
 *
 * Запуск (после npm run build, с теми же переменными, что у API):
 *   API_INSTANCES=4 node --env-file=.env load/cluster.mjs
 */
import cluster from 'node:cluster';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Круговое распределение задаётся явно: в Windows по умолчанию соединения
// раздаёт операционная система, и они ложатся на экземпляры неравномерно.
cluster.schedulingPolicy = cluster.SCHED_RR;

const instances = Number(process.env.API_INSTANCES ?? '1');

if (cluster.isPrimary) {
  console.log(`Экземпляров API: ${instances}, порт ${process.env.PORT ?? 3000}`);
  for (let i = 0; i < instances; i++) cluster.fork();

  cluster.on('exit', (worker, code) => {
    console.error(`Экземпляр ${worker.process.pid} завершился с кодом ${code}`);
  });
} else {
  const here = path.dirname(fileURLToPath(import.meta.url));
  await import(pathToFileURL(path.join(here, '..', 'dist', 'main.js')).href);
}

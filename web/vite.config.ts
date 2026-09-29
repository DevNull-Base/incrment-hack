import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { defineConfig, loadEnv } from 'vite'

/**
 * Порты зафиксированы (strictPort): http://localhost:5173 и :4173 прописаны
 * в redirect_uri клиента crm-frontend в keycloak/realm-export.json. На другом
 * порту Keycloak отклонил бы вход.
 *
 * С бэкендом (VITE_API_TARGET) запросы идут через прокси дев-сервера: адреса
 * в коде относительные (/api/v1/...), как и на стенде, где статику и API
 * отдаёт один домен, — поэтому CORS в схеме не участвует.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, import.meta.dirname, 'VITE_')
  const target = env.VITE_API_TARGET

  const proxy = target
    ? {
        '/api': { target, changeOrigin: true },
        // Канал обновлений socket.io (пространство имён /ws живёт внутри него).
        '/socket.io': { target, changeOrigin: true, ws: true },
      }
    : undefined

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, './src'),
      },
    },
    server: { port: 5173, strictPort: true, proxy },
    preview: { port: 4173, strictPort: true, proxy },
  }
})

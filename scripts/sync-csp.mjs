// CSP в vercel.json запинен на поддомен конкретного проекта Supabase, а Vercel
// читает этот файл из репозитория ещё до сборки — подставить домен во время
// build нельзя. Поэтому синхронизация отдельным шагом:
//   node scripts/sync-csp.mjs          привести connect-src к VITE_SUPABASE_URL
//   node scripts/sync-csp.mjs --check  только проверить (используется в CI)
// без VITE_SUPABASE_URL в окружении шаг пропускается: у форков своего проекта нет
import { readFileSync, writeFileSync } from 'node:fs'

const VERCEL = 'vercel.json'
const ENV_FILES = ['.env.local', '.env']

const readEnvUrl = () => {
  if (process.env.VITE_SUPABASE_URL) return process.env.VITE_SUPABASE_URL
  for (const file of ENV_FILES) {
    try {
      const line = readFileSync(file, 'utf8')
        .split('\n')
        .find((l) => l.startsWith('VITE_SUPABASE_URL='))
      if (line) return line.slice('VITE_SUPABASE_URL='.length).trim()
    } catch {
      // файла нет — идём дальше
    }
  }
  return null
}

const url = readEnvUrl()
if (url === null || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)) {
  console.log('sync-csp: VITE_SUPABASE_URL не задан или не похож на проект Supabase, пропускаю')
  process.exit(0)
}

const host = new URL(url).host
const raw = readFileSync(VERCEL, 'utf8')
const wanted = `connect-src 'self' https://${host} wss://${host};`
const next = raw.replace(/connect-src [^;]+;/, wanted)

if (next === raw) {
  console.log('sync-csp: CSP уже соответствует', host)
  process.exit(0)
}
if (process.argv.includes('--check')) {
  console.error(`sync-csp: CSP в ${VERCEL} не совпадает с VITE_SUPABASE_URL (${host})`)
  console.error('запусти: node scripts/sync-csp.mjs')
  process.exit(1)
}
writeFileSync(VERCEL, next)
console.log('sync-csp: connect-src обновлён на', host)

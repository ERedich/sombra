import http from 'node:http'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import pino from 'pino'
import { pinoHttp } from 'pino-http'
import { pingDb, pool } from './db.js'
import { env } from './env.js'
import auditLogRouter from './routes/auditLog.js'
import authRouter from './routes/auth.js'
import assetClassificationsRouter from './routes/asset-classifications.js'
import assetsRouter from './routes/assets.js'
import costcentersRouter from './routes/costcenters.js'
import workTypesRouter from './routes/work-types.js'
import categoriesRouter from './routes/categories.js'
import employeesRouter from './routes/employees.js'
import workgroupsRouter from './routes/workgroups.js'
import userGroupsRouter from './routes/user-groups.js'
import { responseTimeHeader } from './middleware/perfHttp.js'
import sitesRouter from './routes/sites.js'
import usersRouter from './routes/users.js'
import workOrdersRouter from './routes/work-orders.js'
import workPlansRouter, { generatorActorSystem } from './routes/work-plans.js'
import tableLayoutsRouter from './routes/table-layouts.js'
import searchPresetsRouter from './routes/search-presets.js'
import notificationsRouter from './routes/notifications.js'
import transactionsRouter from './routes/transactions.js'
import appParametersRouter from './routes/app-parameters.js'
import { runWorkPlanGenerator } from './services/workPlanWoGen.js'
import localesRouter from './routes/locales.js'
import translationsRouter from './routes/translations.js'
import { initWorkOrderRealtime } from './realtime/workOrderSocket.js'

const logger = pino({ level: env.NODE_ENV === 'production' ? 'info' : 'debug' })

const app = express()
app.use(helmet())
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  }),
)
app.use(express.json())
/** Must run before routes so every /api request is logged with `responseTime` (ms). */
app.use(
  pinoHttp({
    logger,
    autoLogging: true,
    customSuccessMessage(req, _res, responseTime) {
      return `${req.method} ${req.originalUrl ?? req.url} ${responseTime}ms`
    },
  }),
)
/** Exposes server-only time in X-Response-Time for comparison with browser TTFB. */
app.use(responseTimeHeader)
app.use('/api/auth', authRouter)
app.use('/api/locales', localesRouter)
app.use('/api/translations', translationsRouter)
app.use('/api/audit-log', auditLogRouter)
app.use('/api/sites', sitesRouter)
app.use('/api/assets', assetsRouter)
app.use('/api/asset-classifications', assetClassificationsRouter)
app.use('/api/costcenters', costcentersRouter)
app.use('/api/work-types', workTypesRouter)
app.use('/api/categories', categoriesRouter)
app.use('/api/employees', employeesRouter)
app.use('/api/workgroups', workgroupsRouter)
app.use('/api/user-groups', userGroupsRouter)
app.use('/api/users', usersRouter)
app.use('/api/work-orders', workOrdersRouter)
app.use('/api/work-plans', workPlansRouter)
app.use('/api/table-layouts', tableLayoutsRouter)
app.use('/api/search-presets', searchPresetsRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/transactions', transactionsRouter)
app.use('/api/app-parameters', appParametersRouter)

app.get('/api/health', async (_req, res) => {
  try {
    const db = await pingDb()
    res.json({ ok: true, db })
  } catch (e) {
    logger.error(e)
    res.status(500).json({
      ok: false,
      db: false,
      error: e instanceof Error ? e.message : 'Health check failed',
    })
  }
})

app.post('/api/ai/suggest', (_req, res) => {
  if (!env.OPENAI_API_KEY) {
    res.status(503).json({ error: 'AI provider not configured (set OPENAI_API_KEY).' })
    return
  }
  res.status(501).json({ error: 'AI suggest endpoint not implemented yet.' })
})

const httpServer = http.createServer(app)

initWorkOrderRealtime(httpServer)

const WORK_PLAN_GEN_MS = 5 * 60 * 1000
function runWorkPlanGenJob(): void {
  void runWorkPlanGenerator(pool, generatorActorSystem()).catch((err) => {
    logger.error({ err }, 'work plan generator failed')
  })
}
setImmediate(runWorkPlanGenJob)
setInterval(runWorkPlanGenJob, WORK_PLAN_GEN_MS)

httpServer.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, 'CMMS API listening')
})

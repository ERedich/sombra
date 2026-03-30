import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

export type AppLocaleRow = {
  code: string
  native_name: string
  enabled: boolean
  sort_order: number
}

/** Public: enabled locales for login and UI. */
router.get('/', async (_req, res) => {
  try {
    const r = await pool.query<AppLocaleRow>(
      `SELECT code, native_name, enabled, sort_order
       FROM app_locales
       WHERE enabled = true
       ORDER BY sort_order ASC, code ASC`,
    )
    res.json({ locales: r.rows })
  } catch (e) {
    console.error(e)
    res.status(500).json({ error: 'Failed to load locales.' })
  }
})

export default router

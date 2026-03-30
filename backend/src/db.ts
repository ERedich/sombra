import pg from 'pg'
import { env } from './env.js'

const { Pool } = pg

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
})

export async function pingDb(): Promise<boolean> {
  const client = await pool.connect()
  try {
    await client.query('SELECT 1')
    return true
  } catch {
    return false
  } finally {
    client.release()
  }
}

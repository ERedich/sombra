/**
 * Backfill vector embeddings for every row in `work_orders` that is missing an
 * entry (or whose source text has changed) in `work_order_embeddings`.
 *
 * Safe to run multiple times: rows with a matching `source_hash` + `model` are
 * skipped without an OpenAI call. Requires `OPENAI_API_KEY` in backend/.env.
 *
 * Usage (from repo root or backend/):
 *   npm run ai:backfill-wo-embeddings -w backend
 *   npm run ai:backfill-wo-embeddings        (when cwd is backend/)
 */
import { env } from '../src/env.js'
import { pool } from '../src/db.js'
import {
  embedWorkOrdersBatch,
  loadWorkOrderEmbedRowsPage,
  type WorkOrderEmbedRow,
} from '../src/ai/embeddings/workOrderEmbed.js'

const PAGE_SIZE = 100

async function main() {
  if (!env.OPENAI_API_KEY?.trim()) {
    console.error(
      'OPENAI_API_KEY is not set. Configure backend/.env before running this script.',
    )
    process.exit(1)
  }

  console.log(
    `Backfilling work_order_embeddings (model=${env.OPENAI_EMBEDDING_MODEL}, batch=${env.AI_EMBEDDING_BATCH_SIZE})...`,
  )

  let afterId: string | null = null
  let totalSeen = 0
  let totalEmbedded = 0
  let totalSkipped = 0

  while (true) {
    const page: WorkOrderEmbedRow[] = await loadWorkOrderEmbedRowsPage(pool, {
      afterId,
      pageSize: PAGE_SIZE,
    })
    if (page.length === 0) break

    const { embedded, skipped } = await embedWorkOrdersBatch(pool, page)
    totalSeen += page.length
    totalEmbedded += embedded
    totalSkipped += skipped

    const last = page[page.length - 1]!
    afterId = last.id
    console.log(
      `  page @ last id=${last.id}: seen=${page.length} embedded=${embedded} skipped=${skipped}`,
    )

    if (page.length < PAGE_SIZE) break
  }

  console.log(
    `Done. seen=${totalSeen} embedded=${totalEmbedded} skipped=${totalSkipped}`,
  )
  await pool.end()
}

main().catch(async (err) => {
  console.error(err)
  await pool.end().catch(() => {})
  process.exit(1)
})

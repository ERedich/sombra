/** Rows in the visible table — above this, heavy layout / bulk ops show extra feedback. */
export const TABLE_BULK_ROW_THRESHOLD = 200

/** Minimum mutations (cells, rows, or parallel API ops) to count as “lots” on a large table. */
export const TABLE_BULK_MUTATION_THRESHOLD = 10

export function shouldShowBulkTableFeedback(
  tableRows: number,
  mutationCount: number,
): boolean {
  return (
    tableRows > TABLE_BULK_ROW_THRESHOLD &&
    mutationCount >= TABLE_BULK_MUTATION_THRESHOLD
  )
}

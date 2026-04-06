import type { TFunction } from 'i18next'

export type AssignmentIconKind =
  | 'material'
  | 'employee'
  | 'instructions'
  | 'notification'

export type AssignmentIconRow = {
  has_material_assignment?: boolean
  has_employee_assignment?: boolean
  work_instruction_count?: number
  work_instruction_done_count?: number
  has_notification_assignment?: boolean
}

function instructionTooltip(t: TFunction, row: AssignmentIconRow): string {
  const total = row.work_instruction_count ?? 0
  if (total === 0) return t('wo.assignments_instructions')
  const done = row.work_instruction_done_count ?? 0
  return t('wo.assignments_instructions_progress', { done, total })
}

/**
 * Material, employee, and work-instruction assignment indicators.
 * Inactive: 20% opacity. Active: full opacity; hover uses primary color.
 * When every work instruction is done, the instructions icon uses green-400 (hover: green-500).
 */
export function WorkAssignmentsIcons({
  row,
  t,
  onAssignmentClick,
  showNotificationIcon = false,
}: {
  row: AssignmentIconRow
  t: TFunction
  /** Called when an icon is clicked; wire up when material/employee/instructions flows exist. */
  onAssignmentClick?: (kind: AssignmentIconKind) => void
  /** Shows WO subscription icon when true. */
  showNotificationIcon?: boolean
}) {
  const material = row.has_material_assignment === true
  const employee = row.has_employee_assignment === true
  const total = row.work_instruction_count ?? 0
  const done = row.work_instruction_done_count ?? 0
  const instructions = total > 0
  const allInstructionsDone = instructions && done === total
  const notification = row.has_notification_assignment === true
  const iconClass = 'text-lg'

  const btnBase =
    'border-none bg-transparent cursor-pointer border-round inline-flex align-items-center justify-content-center ' +
    'p-2 m-0 transition-colors transition-duration-150 focus:outline-none'

  function btnClass(active: boolean) {
    return active ? `${btnBase} hover:text-primary` : btnBase
  }

  function instructionBtnClass() {
    if (!instructions) return btnBase
    if (allInstructionsDone) {
      return `${btnBase} text-green-400 hover:text-green-500`
    }
    return `${btnBase} hover:text-primary`
  }

  function employeeBtnClass() {
    if (!employee) return `${btnBase} hover:text-primary`
    return `${btnBase} text-green-400 hover:text-primary`
  }

  function notificationBtnClass() {
    if (!notification) return btnBase
    return `${btnBase} text-green-400 hover:text-green-500`
  }

  const instructionTitle = instructionTooltip(t, row)

  return (
    <div
      className="flex align-items-center gap-4 white-space-nowrap"
      aria-label={t('wo.col_assignments')}
    >
      <button
        type="button"
        className={btnClass(material)}
        style={{ opacity: material ? 1 : 0.2 }}
        title={t('wo.assignments_material')}
        aria-label={t('wo.assignments_material')}
        onClick={(e) => {
          e.stopPropagation()
          onAssignmentClick?.('material')
        }}
      >
        <i className={`pi pi-box ${iconClass}`} aria-hidden />
      </button>
      <button
        type="button"
        className={employeeBtnClass()}
        style={{ opacity: employee ? 1 : 0.2 }}
        title={t('wo.assignments_employee')}
        aria-label={t('wo.assignments_employee')}
        onClick={(e) => {
          e.stopPropagation()
          onAssignmentClick?.('employee')
        }}
      >
        <i className={`pi pi-user ${iconClass}`} aria-hidden />
      </button>
      <button
        type="button"
        className={instructionBtnClass()}
        style={{ opacity: instructions ? 1 : 0.2 }}
        title={instructionTitle}
        aria-label={instructionTitle}
        onClick={(e) => {
          e.stopPropagation()
          onAssignmentClick?.('instructions')
        }}
      >
        <i className={`pi pi-list ${iconClass}`} aria-hidden />
      </button>
      {showNotificationIcon ? (
        <button
          type="button"
          className={notificationBtnClass()}
          style={{ opacity: notification ? 1 : 0.2 }}
          title={
            notification
              ? t('notifications.unsubscribe_action')
              : t('notifications.subscribe_action')
          }
          aria-label={
            notification
              ? t('notifications.unsubscribe_action')
              : t('notifications.subscribe_action')
          }
          onClick={(e) => {
            e.stopPropagation()
            onAssignmentClick?.('notification')
          }}
        >
          <i className={`pi pi-bell ${iconClass}`} aria-hidden />
        </button>
      ) : null}
    </div>
  )
}

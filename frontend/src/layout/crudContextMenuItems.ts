import type { TFunction } from 'i18next'
import type { MenuItem } from 'primereact/menuitem'
import { formatDateTime } from '../utils/dateTime'

/** PrimeIcons — aligned with CRUD toolbar buttons across the app. */
export const CRUD_CONTEXT_ICON_CREATE = 'pi pi-plus'
export const CRUD_CONTEXT_ICON_EDIT = 'pi pi-pencil'
export const CRUD_CONTEXT_ICON_DELETE = 'pi pi-trash'

export type CrudContextMenuOptions = {
  onCreate: () => void
  onEdit: () => void
  onDelete: () => void
  disableCreate?: boolean
  disableEdit?: boolean
  disableDelete?: boolean
}

/** Created/updated timestamps and actor display names for context menu “Audit info”. */
export type RowAuditSnapshot = {
  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

export function rowAuditSnapshot(row: {
  created_at: string
  updated_at: string
  created_by_login_name?: string | null
  updated_by_login_name?: string | null
}): RowAuditSnapshot {
  return {
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by_login_name ?? null,
    updatedBy: row.updated_by_login_name ?? null,
  }
}

export type CrudContextMenuExtras = {
  /** When set, adds an “Audit info” submenu (created/updated + users). */
  audit?: RowAuditSnapshot | null
  /** Admin-only link to filtered audit log (same as toolbar “Audit history”). */
  auditHistory?: { visible: boolean; onNavigate: () => void }
}

export function buildCrudContextMenuItems(
  o: CrudContextMenuOptions,
  t: TFunction,
): MenuItem[] {
  return [
    {
      label: t('common.create'),
      icon: CRUD_CONTEXT_ICON_CREATE,
      disabled: o.disableCreate,
      command: () => o.onCreate(),
    },
    {
      label: t('common.edit'),
      icon: CRUD_CONTEXT_ICON_EDIT,
      disabled: o.disableEdit,
      command: () => o.onEdit(),
    },
    {
      label: t('common.delete'),
      icon: CRUD_CONTEXT_ICON_DELETE,
      disabled: o.disableDelete,
      command: () => o.onDelete(),
    },
  ]
}

function buildAuditInfoSubmenu(
  audit: RowAuditSnapshot,
  t: TFunction,
): MenuItem {
  const dash = t('common.em_dash')
  return {
    label: t('crud.audit_info'),
    icon: 'pi pi-info-circle',
    items: [
      {
        label: t('audit_line.created', {
          value: formatDateTime(audit.createdAt),
        }),
        icon: 'pi pi-calendar-plus',
        disabled: true,
      },
      {
        label: t('audit_line.created_by', {
          value: audit.createdBy ?? dash,
        }),
        icon: 'pi pi-user',
        disabled: true,
      },
      {
        label: t('audit_line.updated', {
          value: formatDateTime(audit.updatedAt),
        }),
        icon: 'pi pi-calendar',
        disabled: true,
      },
      {
        label: t('audit_line.updated_by', {
          value: audit.updatedBy ?? dash,
        }),
        icon: 'pi pi-user-edit',
        disabled: true,
      },
    ],
  }
}

/**
 * CRUD items plus optional “Audit history” and nested “Audit info” (timestamps + actors).
 * Use with PrimeReact `ContextMenu`.
 */
export function buildCrudContextMenuModel(
  o: CrudContextMenuOptions,
  t: TFunction,
  extras?: CrudContextMenuExtras,
): MenuItem[] {
  const items = buildCrudContextMenuItems(o, t)
  const hasAudit = extras?.audit != null
  const hasHistory = extras?.auditHistory?.visible === true
  if (!hasAudit && !hasHistory) return items

  const more: MenuItem[] = [{ separator: true }]
  if (hasHistory) {
    more.push({
      label: t('common.audit_history'),
      icon: 'pi pi-history',
      command: () => extras!.auditHistory!.onNavigate(),
    })
  }
  if (hasAudit) {
    if (hasHistory) more.push({ separator: true })
    more.push(buildAuditInfoSubmenu(extras!.audit!, t))
  }
  return [...items, ...more]
}

/** Shared `ContextMenu` props: wider panel, responsive breakpoint. */
export const CRUD_CONTEXT_MENU_PROPS = {
  className: 'app-crud-context-menu',
  breakpoint: '768px',
  scrollHeight: 'min(70vh, 28rem)',
} as const

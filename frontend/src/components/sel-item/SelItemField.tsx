import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from 'primereact/button'
import { InputText } from 'primereact/inputtext'
import { Sidebar } from 'primereact/sidebar'

export type SelItemFieldProps = {
  id?: string
  /** Read-only display text (e.g. key — name). */
  valueLabel: string
  placeholder?: string
  disabled?: boolean
  sidebarVisible: boolean
  onSidebarHide: () => void
  /** Opens the sidebar (e.g. magnifying-glass control). */
  onOpenSidebar: () => void
  /** Accessibility label for the open control. */
  triggerAriaLabel?: string
  showClear?: boolean
  onClear?: () => void
  /** Drawer body (e.g. picker table). */
  children: ReactNode
  /** Sidebar panel title. */
  sidebarHeader?: string
}

/**
 * Generic selection field: read-only text + magnifying-glass button opening a right Sidebar.
 * Use for large option sets; load data inside the drawer, not in the parent form.
 */
export function SelItemField({
  id,
  valueLabel,
  placeholder,
  disabled = false,
  sidebarVisible,
  onSidebarHide,
  onOpenSidebar,
  triggerAriaLabel,
  showClear = false,
  onClear,
  children,
  sidebarHeader,
}: SelItemFieldProps) {
  const { t } = useTranslation()
  const ph = placeholder ?? t('sel_item.placeholder')
  const openLabel = triggerAriaLabel ?? t('sel_item.open_selection')
  const drawerTitle = sidebarHeader ?? t('sel_item.sidebar_title')
  return (
    <>
      <div className="p-inputgroup w-full">
        <InputText
          id={id}
          readOnly
          value={valueLabel}
          placeholder={ph}
          disabled={disabled}
          className="w-full"
        />
        {showClear && onClear ? (
          <Button
            type="button"
            icon="pi pi-times"
            severity="secondary"
            outlined
            disabled={disabled}
            onClick={onClear}
            aria-label="Clear selection"
          />
        ) : null}
        <Button
          type="button"
          icon="pi pi-search"
          disabled={disabled}
          onClick={onOpenSidebar}
          aria-label={openLabel}
        />
      </div>
      <Sidebar
        visible={sidebarVisible}
        position="right"
        onHide={onSidebarHide}
        dismissable
        blockScroll
        baseZIndex={1200}
        style={{ width: 'calc(100vw * 2 / 3)' }}
        header={drawerTitle}
      >
        {children}
      </Sidebar>
    </>
  )
}

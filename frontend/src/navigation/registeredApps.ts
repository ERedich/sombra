import type { AuthUser } from '../auth'

export type RegisteredApp = {
  path: string
  /** i18n msg_key for the nav / quick access label */
  labelKey: string
  icon: string
  adminOnly?: boolean
}

/** Top-level home route (not nested under a section). */
export const HOME_APP: RegisteredApp = {
  path: '/',
  labelKey: 'nav.home',
  icon: 'pi pi-home',
}

export type NavSection = {
  id: string
  labelKey: string
  icon: string
  children: RegisteredApp[]
}

/**
 * Sidebar structure: Home first, then grouped sections with sub-items.
 * Order matches product areas (see AppShell).
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'user-management',
    labelKey: 'nav.section_user_management',
    icon: 'pi pi-users',
    children: [
      { path: '/users', labelKey: 'nav.users', icon: 'pi pi-user' },
      { path: '/user-groups', labelKey: 'nav.user_groups', icon: 'pi pi-sitemap' },
    ],
  },
  {
    id: 'settings',
    labelKey: 'nav.section_settings',
    icon: 'pi pi-cog',
    children: [
      { path: '/hotkeys', labelKey: 'nav.keyboard_shortcuts', icon: 'pi pi-key' },
      { path: '/translations', labelKey: 'nav.translations', icon: 'pi pi-language' },
      { path: '/template-app', labelKey: 'nav.template_app', icon: 'pi pi-book' },
    ],
  },
  {
    id: 'administration',
    labelKey: 'nav.section_administration',
    icon: 'pi pi-shield',
    children: [
      { path: '/sites', labelKey: 'nav.sites', icon: 'pi pi-building' },
      {
        path: '/audit-log',
        labelKey: 'nav.audit_log',
        icon: 'pi pi-history',
        adminOnly: true,
      },
    ],
  },
  {
    id: 'basic-data',
    labelKey: 'nav.section_basic_data',
    icon: 'pi pi-database',
    children: [
      { path: '/costcenters', labelKey: 'nav.costcenters', icon: 'pi pi-briefcase' },
      { path: '/work-types', labelKey: 'nav.work_types', icon: 'pi pi-palette' },
      { path: '/categories', labelKey: 'nav.categories', icon: 'pi pi-bookmark' },
      { path: '/employees', labelKey: 'nav.employees', icon: 'pi pi-id-card' },
      { path: '/workgroups', labelKey: 'nav.workgroups', icon: 'pi pi-users' },
      {
        path: '/asset-classifications',
        labelKey: 'nav.asset_classifications',
        icon: 'pi pi-tags',
      },
    ],
  },
  {
    id: 'maintenance',
    labelKey: 'nav.section_maintenance',
    icon: 'pi pi-wrench',
    children: [
      { path: '/assets', labelKey: 'nav.asset_management', icon: 'pi pi-box' },
      { path: '/tree-structure', labelKey: 'nav.tree_structure', icon: 'pi pi-list' },
    ],
  },
  {
    id: 'service',
    labelKey: 'nav.section_service',
    icon: 'pi pi-clipboard',
    children: [
      { path: '/work-orders', labelKey: 'nav.work_orders', icon: 'pi pi-file-edit' },
      {
        path: '/work-planning',
        labelKey: 'nav.work_planning',
        icon: 'pi pi-calendar-plus',
      },
    ],
  },
  {
    id: 'purchase',
    labelKey: 'nav.section_purchase',
    icon: 'pi pi-shopping-cart',
    children: [],
  },
  {
    id: 'material',
    labelKey: 'nav.section_material',
    icon: 'pi pi-inbox',
    children: [],
  },
]

function filterAppsForUser(
  apps: RegisteredApp[],
  user: AuthUser,
): RegisteredApp[] {
  return apps.filter((a) => !a.adminOnly || user.role === 'admin')
}

/** Flat list of all app routes (for quick access, shortcuts, etc.). */
export function getRegisteredAppsFlat(): RegisteredApp[] {
  return [HOME_APP, ...NAV_SECTIONS.flatMap((s) => s.children)]
}

export const REGISTERED_APPS: RegisteredApp[] = getRegisteredAppsFlat()

export function getAppsForUser(user: AuthUser | null): RegisteredApp[] {
  if (!user) return []
  return filterAppsForUser(getRegisteredAppsFlat(), user)
}

export function getNavSectionsForUser(user: AuthUser | null): NavSection[] {
  if (!user) return []
  return NAV_SECTIONS.map((section) => ({
    ...section,
    children: filterAppsForUser(section.children, user),
  }))
}

function pathMatchesRoute(appPath: string, pathname: string): boolean {
  if (appPath === '/') return pathname === '/'
  return pathname === appPath || pathname.startsWith(`${appPath}/`)
}

/** Whether the current URL belongs to a section (any child active). */
export function isSectionActive(section: NavSection, pathname: string): boolean {
  return section.children.some((c) => pathMatchesRoute(c.path, pathname))
}

import type { AuthUser } from '../auth'



export type RegisteredApp = {

  path: string

  /** i18n msg_key for the nav / quick access label */

  labelKey: string

  icon: string

  adminOnly?: boolean

}



/** Order matches the main shell sidebar (see AppShell). */

export const REGISTERED_APPS: RegisteredApp[] = [

  { path: '/', labelKey: 'nav.overview', icon: 'pi pi-home' },

  { path: '/hotkeys', labelKey: 'nav.keyboard_shortcuts', icon: 'pi pi-key' },

  { path: '/users', labelKey: 'nav.users', icon: 'pi pi-users' },

  { path: '/sites', labelKey: 'nav.sites', icon: 'pi pi-building' },

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

  { path: '/assets', labelKey: 'nav.asset_management', icon: 'pi pi-box' },

  { path: '/work-orders', labelKey: 'nav.work_orders', icon: 'pi pi-file-edit' },

  {
    path: '/work-planning',
    labelKey: 'nav.work_planning',
    icon: 'pi pi-calendar-plus',
  },

  {

    path: '/tree-structure',

    labelKey: 'nav.tree_structure',

    icon: 'pi pi-list',

  },

  { path: '/user-groups', labelKey: 'nav.user_groups', icon: 'pi pi-sitemap' },

  { path: '/template-app', labelKey: 'nav.template_app', icon: 'pi pi-book' },

  {

    path: '/translations',

    labelKey: 'nav.translations',

    icon: 'pi pi-language',

  },

  {

    path: '/audit-log',

    labelKey: 'nav.audit_log',

    icon: 'pi pi-history',

    adminOnly: true,

  },

]



export function getAppsForUser(user: AuthUser | null): RegisteredApp[] {

  if (!user) return []

  return REGISTERED_APPS.filter(

    (a) => !a.adminOnly || user.role === 'admin',

  )

}


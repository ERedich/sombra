# CMMS — guidelines

## Core Functionalities

### Audit log (Part 11–oriented CUD trail)

The backend maintains an **append-only** `audit_log` table in PostgreSQL for every **Create, Update, and Delete** that changes persisted data exposed through the API. **HTTP GET (reads) are not logged** (by product decision). This supports expectations for **computer-generated** audit information with **timestamps** and traceability of **who** changed **what**, consistent with discussions of 21 CFR Part 11 audit trails and electronic records (see the [Johner Institut overview](https://www.johner-institut.de/blog/regulatory-affairs/21-cfr-part-11/) and the FDA’s [Part 11 Scope and Application guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/part-11-electronic-records-electronic-signatures-scope-and-application)). **Compliance is not guaranteed by software alone**—validation, access control, procedures, and training remain your responsibility.

- **Create:** `before_state` is null; `after_state` is a redacted snapshot of the new row.
- **Update:** `before_state` and `after_state` are full redacted snapshots; `field_changes` lists only keys whose values changed (`{ before, after }` per field).
- **Delete:** `before_state` is the redacted row; `after_state` is null.
- **Sensitive fields:** e.g. `password_hash` is never written for `user`-type resources (see user CRUD routes).
- **Immutability:** Rows in `audit_log` cannot be updated or deleted through normal application use (database trigger). A database superuser can still bypass this.
- **Scope:** Data that exists only in the browser (e.g. **Template app** `sessionStorage`) is **not** in `audit_log`; only **API-backed** persistence is audited.
- **Successful login** is recorded as a separate `auth_login` entry (minimal `after_state`, no passwords).
- **Developer rule:** Any new mutating route must perform the data change and `audit_log` insert in the **same transaction** using the shared audit helper in [`backend/src/audit/auditLog.ts`](backend/src/audit/auditLog.ts), following the pattern in [`backend/src/routes/sites.ts`](backend/src/routes/sites.ts).

**Admin inspection API:** `GET /api/audit-log` (JWT + `admin` role) supports `limit`, `offset`, and optional filters `resource_type`, `resource_id`, `actor_user_id`, `from`, `to` (ISO timestamps).

- **Sites and Users apps (audit log + UI):** Create, update, and delete on [`/api/sites`](backend/src/routes/sites.ts) and [`/api/users`](backend/src/routes/users.ts) are written to `audit_log` in the **same transaction** as the mutation (`writeAudit` after `redactForAudit`; user snapshots include `additional_site_ids`, and `password_hash` is never stored in audit state). List screens follow **Table Structure** → **List tables — when / who on screen**. **Administrators** also get an **Audit history** control when a row is selected or the list is filtered by `?siteId=` / `?userId=` (deep link from the audit log); it opens the audit log filtered to that `resource_type` and `resource_id`.

## General functionality

- **Quick access:** Every new app must be available in **Quick access** (the keyboard-driven app launcher). Register it in [`frontend/src/navigation/registeredApps.ts`](frontend/src/navigation/registeredApps.ts) with `path`, **`labelKey`** (an i18n message key such as `nav.my_app`, not raw English), and `icon` (and `adminOnly` when restricted to administrators), in the same order as the sidebar where applicable. The launcher reads this list via [`frontend/src/layout/QuickAccessProvider.tsx`](frontend/src/layout/QuickAccessProvider.tsx).

## Common Abbreviations

- **WO:** Work Order
- **SP:** Search Panel
- **MW:** Modal Window
- **QS:** Quick Search or Global Search
- **PS:** Preset (done in searchpanel)
- **WP:** Work Plan
- **DTF:** Date/time display format (general app parameter `general.dtf`)

## WO Process (work orders)

Product rules for **starting** and **stopping** work on a work order (WO). The **API** is authoritative; the **Work orders** and **Monitoring** UIs disable **Start** when the same conditions would cause `POST /api/work-orders/:id/actions/start` to return **403** (tooltips explain the reason).

### Start work

- **Endpoint:** `POST /api/work-orders/:id/actions/start` ([`backend/src/routes/work-orders.ts`](backend/src/routes/work-orders.ts)).
- **Allowed statuses:** `open`, `assigned`, `on_hold` (from hold, status becomes `continued`; otherwise `started`).
- **Site access:** The user must be allowed to see the WO’s site (same as other WO APIs); otherwise **404**.
- **Linked employee:** `users.employee_id` must be set. Users without a linked employee cannot start.
- **Workgroup membership:** Every WO in the list/detail model has a **`workgroup_id`**. The linked employee must appear in **`workgroup_employees`** for that workgroup. This applies even when assignment is not required for start: it prevents starting (or auto-assigning oneself on start) outside the WO’s crew.
- **Assignment (SWB — “start work behaviour”):** App setting **`start_requires_assignment`** (see **App parameters** → work orders, [`backend/src/services/appSettings.ts`](backend/src/services/appSettings.ts)). When **true** (default), the linked employee must also be listed in **`work_order_employees`** for that WO. When **false**, any user with a linked employee who passes the workgroup check may start.
- **Auto-assign (UAA):** When **`start_requires_assignment`** is **false** and **`user_auto_assign_on_start`** is **true** (defaults in code), the server adds employees to **`work_order_employees`** when needed: on **start** (the actor), and on **feedback** (every employee referenced in a feedback entry), using the same **site** and **workgroup** rules as manual assignment (`PUT /api/work-orders/:id/employees`). If UAA is **off** and SWB is **off**, only the **current user’s** linked employee may appear in feedback without a prior WO assignment (legacy behaviour for self-only).

### Stop work (feedback)

- **UI:** The **Stop** control opens the WO dialog on the **Feedback** tab (there is no separate “stop” HTTP action; wrapping up uses **feedback** and related routes).
- **Who can click Stop:** The SPA uses the same **linked employee** and **SWB assignment** gating as for **Start** (so unassigned users do not open feedback from the grid when SWB requires assignment). **Workgroup membership** is enforced on **start** in the API; the **Stop** button is not additionally gated by workgroup in the UI so operators who are already running the WO can still open feedback.

### Configuration and auth payload

- **App parameters** UI persists WO behaviour into **`app_settings`** (`wo` key). Changes apply to new requests immediately.
- **`GET /api/auth/me`** and login responses include **`employee_workgroup_ids`** (UUID strings for `workgroup_employees` rows for the user’s linked employee) so the SPA can disable **Start** without per-row round-trips. After **workgroup membership** changes for that employee, the user should **refresh** the session (re-login or reload so `/api/auth/me` runs) for tooltips and disabled state to stay accurate.

## Internationalization (i18n)

- **UI chrome:** Fixed copy (labels, buttons, placeholders for controlled text, table headers, navigation, dialogs, toasts, etc.) must use **i18next** with stable **`msg_key`** strings and `t('…')` in the React app. Do **not** translate user-entered content, API-returned domain fields, or audit payloads.
- **Data:** Strings are stored in PostgreSQL (`app_locales`, `ui_translations`); the SPA loads them via [`GET /api/translations`](backend/src/routes/translations.ts). Enabled languages are listed with [`GET /api/locales`](backend/src/routes/locales.ts). Users choose language **at login**; `users.preferred_locale` and the JWT include the active locale code.
- **New apps and labels:** When adding a route, sidebar entry, or quick access item, add a **`labelKey`** to [`registeredApps.ts`](frontend/src/navigation/registeredApps.ts), add matching rows for **each** enabled locale in `ui_translations` (migration seed and/or **Translations** app), and use `t(labelKey)` where the label is shown. Follow the same pattern for any new fixed strings (prefer dotted keys, e.g. `myfeature.save`).
- **New languages:** Insert a row into `app_locales`, provide `ui_translations` for that `code`, and extend the PrimeReact locale map in [`frontend/src/i18n/registerPrimeLocales.ts`](frontend/src/i18n/registerPrimeLocales.ts) when component date/number formatting should match that language.

## Date and time display (DTF)

- **Single setting:** **Date format always follows the general app parameter `dtf`** (Date/time display format — **App parameters → General**). That choice is the source of truth for how **calendar dates** are shown and entered, not a hard-coded pattern per screen.
- **PrimeReact `Calendar`:** Either rely on [`PrimeLocaleSync`](frontend/src/i18n/PrimeLocaleSync.tsx) (it applies `dtf` to the active Prime locale’s `dateFormat`), or set `dateFormat={primeDateFormatForDtf(dtf)}` using [`useAppParameters()`](frontend/src/layout/AppParametersProvider.tsx) and [`primeDateFormatForDtf`](frontend/src/utils/dateTimeFormatPreference.ts). **Do not** pin a fixed `dateFormat` such as `yy-mm-dd` on pickers unless there is a documented exception.
- **Read-only labels:** Use [`formatDate`](frontend/src/utils/dateTime.ts) / [`formatDateTime`](frontend/src/utils/dateTime.ts) for table cells and headings so list and timetable views match the same `dtf` preference.

## Modal Window Handling

- **Backdrop click:** Clicking outside the modal window (on the dimmed mask behind it) **must** close the modal, same as an explicit Cancel/Close action (unless a specific flow requires blocking dismissal—then document the exception in code and here).
- **Implementation:** On PrimeReact `Dialog`, set **`dismissableMask`** so mask clicks invoke `onHide`. Keep **`modal`** (default) so focus stays trapped appropriately while the dialog is open.
- **In-flight actions:** For form dialogs that disable Cancel while saving, use **`dismissableMask={!saving}`** (or equivalent) so the mask cannot dismiss the dialog during a submit—consistent with the disabled Cancel button.
- **ConfirmDialog:** Use **`dismissableMask`** on `<ConfirmDialog />` as well; closing via the mask is treated like cancel/reject (delete is **not** performed unless the user accepts).
- **Open / close animation (centered modals):** For PrimeReact `Dialog` and `ConfirmDialog` with default **`position="center"`**, the app applies a global style in [`frontend/src/App.css`](frontend/src/App.css): **open** — slide in from the **left** and **fade in**; **close** — slide out to the **right** and **fade out**. Timing stays within PrimeReact’s CSSTransition limit for centered dialogs (~150ms). Users who prefer reduced motion get **opacity-only** transitions. Non-center **`position`** values keep PrimeReact’s default placement animation.
- **Tabs:** Modal windows that use tabs **must not** jump in height when switching tabs; keep a **constant height** (e.g. fixed/min height on the tab content area, or layout that reserves space for the tallest panel) so the dialog feels stable and controls do not shift under the cursor.
- **Tabbed modals — default styling (PrimeReact):** For any `TabView` inside a form `Dialog`, use the shared classes in [`frontend/src/App.css`](frontend/src/App.css): set **`className="app-modal-tabview"`** on `TabView` (sliding primary **ink bar** underline; inactive tabs use **muted** bottom borders, not the highlight colour). Wrap each tab panel’s inner content in **`className="app-modal-tab-content …"`** (plus your layout utilities) so **min-height** keeps the dialog body height stable across tab changes. **Users** ([`frontend/src/pages/UsersPage.tsx`](frontend/src/pages/UsersPage.tsx)) is the reference implementation.
- **CRUD form dialogs — minimize:** Use [`AppCrudDialog`](frontend/src/components/app-crud-dialog/AppCrudDialog.tsx) for domain CRUD modal windows (wraps PrimeReact `Dialog`). The header shows **minimize** (`pi-window-minimize`) immediately **left of** **close**. **Minimized** removes the mask and full panel so the background app is usable; **in-memory form state is preserved**. A **docked** bar at the bottom of the viewport (**`.app-mw-minimized-dock`** in [`frontend/src/App.css`](frontend/src/App.css)) shows a truncated title plus **restore** and **close**. **Minimize** is disabled when **`dismissableMask` is `false`** (e.g. while saving), matching blocking dismissal. Parent dialogs that can open **nested** modals should clear those children when minimized (**`onMinimizedChange`** on `AppCrudDialog`). Pass **`dockTitle`** when **`title`** is not a plain string so the dock label is meaningful. **Exclusions (keep plain `Dialog`):** login ([`LoginPage.tsx`](frontend/src/pages/LoginPage.tsx)), Kira ([`KiraAssistantProvider.tsx`](frontend/src/layout/KiraAssistantProvider.tsx)), quick access ([`QuickAccessProvider.tsx`](frontend/src/layout/QuickAccessProvider.tsx)), shell notifications dialog ([`AppShell.tsx`](frontend/src/layout/AppShell.tsx)), table wizard ([`TableWizardDialog.tsx`](frontend/src/table-wizard/TableWizardDialog.tsx)), search presets ([`SearchPresetsDialog.tsx`](frontend/src/table-search/SearchPresetsDialog.tsx)).

## Rules of engagement

### Always apply

- Whenever I need user input I will ask for clarification.
- Whenever I have remarks or see logical flaws, I will inform the user.
- Whenever I think the user might be wrong or missing a point I inform the user.
- Whenever I need the user to do something I state that clearly in a **Your todo** chat message.
- I will not blindly create table columns without describing them initially so user can intervene.

## Table Structure

- Most domain tables use a unique **ID**, business **Key**, and **Name** (see `sites`).
- **Exception — `users`:** no business `key`; the account is identified by **UUID `id`**, with a unique **`login_name`** for sign-in plus **display `name`** (and optional `email`). Passwords are stored hashed only.
- **Bootstrap admin** (`login_name = admin`, created by migrate): cannot be created again via API with that login name, **cannot be updated or deleted** through user or working-site endpoints, and is excluded from the login-time working-site picker in the SPA.
- **Row audit columns (database):** API-backed domain tables (`sites`, `users`, `costcenters`, …) store two complementary kinds of metadata on each row:
  - **Timestamps — when:** **`created_at`** and **`updated_at`** (typically `TIMESTAMPTZ`) record when the row was inserted and last updated. The API returns them as ISO strings; the SPA shows them in list tables as **Created** and **Updated** using locale-aware formatting ([`formatDateTime`](frontend/src/utils/dateTime.ts)).
  - **Actors — who:** **`created_by`** and **`updated_by`** (nullable `UUID` → `users.id`, `ON DELETE SET NULL`) record which user account created the row and last changed it. List APIs expose joined **`created_by_login_name`** / **`updated_by_login_name`** for display as **Created by** / **Updated by**.
  Together, these columns answer **when** and **who** for the **current** row. They are **not** a full change history: the append-only **`audit_log`** (see **Audit log** above) records each mutating API operation with before/after snapshots and optional `field_changes`.

- **List tables — when / who on screen:** Server-backed CRUD pages should show **Created**, **Updated**, **Created by**, and **Updated by** when the API provides the underlying fields, so operators do not need to open the audit log for routine checks. Include timestamp values in **search** (both ISO substrings and formatted display text, as in cost centers). Reference implementations: [`SitesPage`](frontend/src/pages/SitesPage.tsx), [`UsersPage`](frontend/src/pages/UsersPage.tsx), [`CostcentersAppPage`](frontend/src/apps/costcenters/CostcentersAppPage.tsx).

### Site reference column (list UI)

- For `site_id`-scoped domain data, the **site reference** column (site key, name, colour — the column that answers which site a row belongs to) **must not** be included in the **default/base** column set for list tables. Operators can **add** it via the **Table Wizard** when they want it.
- This is a **UI default** only: list APIs may continue to return `site_key`, `site_name`, and related fields; the SPA simply omits that column from the initial column registry unless the user enables it in the wizard.

### Site scope (users and `site_id`-backed data)

Terminology:

- **Accessible sites (non-admin):** **working site ∪ additional sites** (`users.working_site_id` and `user_additional_sites`). This is the same set used to scope **`GET /api/sites`** for non-admins.
- **Admins** (`role = admin`): unrestricted site visibility for list APIs and for CRUD on `site_id`-scoped domain data unless a specific feature documents an exception.

**`site_id`-scoped domain rows** (e.g. `costcenters`, and the same rules apply to future tables that reference `sites.id`):

| Action | Rule |
|--------|------|
| **Read** (list and get-by-id) | Allowed if the row’s **`site_id`** is an **accessible** site (non-admin) or any site (admin). If not allowed, respond **404** (do not leak existence). |
| **Update** | Same as read: user may change the row only if they have **access** to that row’s **`site_id`**. |
| **Delete** | Same as read. |
| **Create** | The new row’s **`site_id`** is always set from the user’s **`working_site_id`** (JWT / DB). The client does not choose the site on create. The user must have a **working site** set (`POST` returns **403** if not). |

So **additional sites are not “read-only”** for domain data: they grant **read, update, and delete** for rows whose `site_id` is in that site. **Create** is the special case: it always stamps **`working_site_id`** as the row’s site reference.

Other notes:

- JWT carries **`working_site_id`** and **`locale`** (`app_locales.code`) for APIs that stamp new rows and for the SPA context.
- **Login:** optional dialog to pick working site when `allow_site_change_on_login` is true and the user has at least two distinct assigned sites; **`POST /api/auth/working-site`** updates `users.working_site_id` and re-issues the JWT.
- **Deletes** on the **`sites`** table are not restricted by user site scope (operational tradeoff; validate in procedures).
- **Reference implementation:** [`backend/src/routes/costcenters.ts`](backend/src/routes/costcenters.ts) implements the table above; new `site_id`-backed resources should follow it.

## App shell and screen layout (shared styling)

Authenticated screens use **`AppShell`** (sidebar + content). Each feature’s main content is a **single primary `Card`** with a consistent **hero header** and body padding.

- **Outer content wrapper:** `className="p-4 max-w-screen-lg mx-auto flex flex-column gap-3"` (use **`max-w-screen-xl`** when the table needs more width, e.g. Users or Audit log). The home / health card may use a narrower max width (e.g. `max-w-30rem`).
- **Card chrome:** `className="shadow-1 border-round-xl overflow-hidden"` on the `Card`, and **`pt={{ header: { className: 'p-0 border-none' } }}`** so the custom header controls padding and borders.
- **Hero header (title strip):** Pass a **`header={...}`** React node — not `title` / `subTitle` props — built from the shared classes in [`frontend/src/App.css`](frontend/src/App.css):
  - Outer: **`app-card-hero`** + flex layout + `p-4 md:p-5`
  - Optional icon tile: **`app-card-hero-icon`** with a PrimeIcons `<i className="pi pi-…">` (pick an icon that matches the screen)
  - **`app-card-hero-title`** on the screen title (`<h1>`)
  - **`app-card-hero-desc`** on the short subtitle / context line (dynamic copy is fine)
- **Card body:** Wrap toolbar, helper text, `DataTable`, and paginator in **`className="px-1 md:px-2"`** so content aligns under the hero.
- **References:** [`frontend/src/pages/SitesPage.tsx`](frontend/src/pages/SitesPage.tsx) and [`frontend/src/apps/hotkeys/HotkeysAppPage.tsx`](frontend/src/apps/hotkeys/HotkeysAppPage.tsx) are the canonical examples; the same pattern is applied across Template, cost centers, user groups, users, audit log, and home.

## Template app — reference skeleton for new apps

- **Role:** The **Template app** is the baseline layout and interaction pattern for every new CRUD-style feature in the frontend. Copy its structure first, then adapt fields, routes, and data layer.
- **Where:** UI route `/template-app`, sidebar **Template app**, source under [`frontend/src/apps/template-app/`](frontend/src/apps/template-app/) (`TemplateAppPage.tsx`, `types.ts`, `temporalStorage.ts`).
- **What to mirror:** **`AppShell`** + **hero `Card`** (see **App shell and screen layout** above); toolbar **Create | Edit | Delete** as a `ButtonGroup`; search field aligned right (shared class `app-crud-toolbar-search` in [`frontend/src/App.css`](frontend/src/App.css)); `DataTable` with single row selection, sortable columns, double-click to edit; form `Dialog`; delete confirmation; `Toast` feedback. If the form uses **`TabView`** inside the `Dialog`, apply **`app-modal-tabview`** / **`app-modal-tab-content`** as in **Modal Window Handling** (reference: **Users** page).
- **Data:** The template persists only to **`sessionStorage`** (tab session, not the database). It is for structure and UX only. Production apps must use the API and PostgreSQL (migrations, routes) per **Table Structure** above.
- **Sites as the full example:** [`frontend/src/pages/SitesPage.tsx`](frontend/src/pages/SitesPage.tsx) is the same baseline wired to the backend (JWT, REST), with extra columns where the domain requires them (e.g. colour, and **Table Structure** → **List tables — when / who on screen**). New apps that need a server: follow **Template app** layout + **Sites** data wiring.

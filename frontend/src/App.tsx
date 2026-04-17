import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect } from 'react'
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { refreshStoredAuthUser } from './api'
import { getStoredUser, getToken } from './auth'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import SitesPage from './pages/SitesPage'
import UsersPage from './pages/UsersPage'
import AuditLogAppPage from './apps/audit-log/AuditLogAppPage'
import WorkOrdersAppPage from './apps/work-orders/WorkOrdersAppPage'
import MonitoringAppPage from './apps/monitoring/MonitoringAppPage'
import TransactionsAppPage from './apps/transactions/TransactionsAppPage'
import WorkPlanningAppPage from './apps/work-planning/WorkPlanningAppPage'
import MonthSchedulerAppPage from './apps/month-scheduler/MonthSchedulerAppPage'
import AssetManagementAppPage from './apps/asset-management/AssetManagementAppPage'
import TreeStructureAppPage from './apps/tree-structure/TreeStructureAppPage'
import AssetClassificationsAppPage from './apps/asset-classifications/AssetClassificationsAppPage'
import CostcentersAppPage from './apps/costcenters/CostcentersAppPage'
import WorkTypesAppPage from './apps/work-types/WorkTypesAppPage'
import ShiftsAppPage from './apps/shifts/ShiftsAppPage'
import ShiftPlannerAppPage from './apps/shift-planner/ShiftPlannerAppPage'
import CapacityPlannerAppPage from './apps/capacity-planner/CapacityPlannerAppPage'
import CategoriesAppPage from './apps/categories/CategoriesAppPage'
import EmployeesAppPage from './apps/employees/EmployeesAppPage'
import WorkgroupsAppPage from './apps/workgroups/WorkgroupsAppPage'
import UserGroupsAppPage from './apps/user-groups/UserGroupsAppPage'
import TemplateAppPage from './apps/template-app/TemplateAppPage'
import MwTemplateEditorAppPage from './apps/mw-template-editor/MwTemplateEditorAppPage'
import HotkeysAppPage from './apps/hotkeys/HotkeysAppPage'
import TranslationsAppPage from './apps/translations/TranslationsAppPage'
import AppParametersAppPage from './apps/app-parameters/AppParametersAppPage'
import NotificationEmailRulesAppPage from './apps/notification-email-rules/NotificationEmailRulesAppPage'
import { useKiraAssistant } from './layout/KiraAssistantProvider'

function ProtectedRoute({ children }: { children: ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />
  }
  return children
}

function AdminRoute({ children }: { children: ReactNode }) {
  if (getStoredUser()?.role !== 'admin') {
    return <Navigate to="/" replace />
  }
  return children
}

/** Old `/ai` URL: open Kira modal and return to home. */
function KiraLegacyPath() {
  const { openKira } = useKiraAssistant()
  const navigate = useNavigate()
  useLayoutEffect(() => {
    openKira()
    navigate('/', { replace: true })
  }, [openKira, navigate])
  return null
}

function AuthUserBootstrap() {
  useEffect(() => {
    void refreshStoredAuthUser()
  }, [])
  return null
}

export default function App() {
  return (
    <>
      <AuthUserBootstrap />
      <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <HomePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <UsersPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/sites"
        element={
          <ProtectedRoute>
            <SitesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/template-app"
        element={
          <ProtectedRoute>
            <TemplateAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/mw-template-editor"
        element={
          <ProtectedRoute>
            <AdminRoute>
              <MwTemplateEditorAppPage />
            </AdminRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/hotkeys"
        element={
          <ProtectedRoute>
            <HotkeysAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/costcenters"
        element={
          <ProtectedRoute>
            <CostcentersAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/work-types"
        element={
          <ProtectedRoute>
            <WorkTypesAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/shifts"
        element={
          <ProtectedRoute>
            <ShiftsAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/shift-planner"
        element={
          <ProtectedRoute>
            <ShiftPlannerAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/capacity-planner"
        element={
          <ProtectedRoute>
            <CapacityPlannerAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/categories"
        element={
          <ProtectedRoute>
            <CategoriesAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/employees"
        element={
          <ProtectedRoute>
            <EmployeesAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/workgroups"
        element={
          <ProtectedRoute>
            <WorkgroupsAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/asset-classifications"
        element={
          <ProtectedRoute>
            <AssetClassificationsAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/assets"
        element={
          <ProtectedRoute>
            <AssetManagementAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/work-orders"
        element={
          <ProtectedRoute>
            <WorkOrdersAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/monitoring"
        element={
          <ProtectedRoute>
            <MonitoringAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/transactions"
        element={
          <ProtectedRoute>
            <TransactionsAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/work-planning"
        element={
          <ProtectedRoute>
            <WorkPlanningAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/month-scheduler"
        element={
          <ProtectedRoute>
            <MonthSchedulerAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/tree-structure"
        element={
          <ProtectedRoute>
            <TreeStructureAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/user-groups"
        element={
          <ProtectedRoute>
            <UserGroupsAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/audit-log"
        element={
          <ProtectedRoute>
            <AuditLogAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/notification-email-rules"
        element={
          <ProtectedRoute>
            <AdminRoute>
              <NotificationEmailRulesAppPage />
            </AdminRoute>
          </ProtectedRoute>
        }
      />
      <Route
        path="/translations"
        element={
          <ProtectedRoute>
            <TranslationsAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/app-parameters"
        element={
          <ProtectedRoute>
            <AppParametersAppPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/ai"
        element={
          <ProtectedRoute>
            <KiraLegacyPath />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}

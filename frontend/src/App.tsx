import type { ReactNode } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { getToken } from './auth'
import HomePage from './pages/HomePage'
import LoginPage from './pages/LoginPage'
import SitesPage from './pages/SitesPage'
import UsersPage from './pages/UsersPage'
import AuditLogAppPage from './apps/audit-log/AuditLogAppPage'
import WorkOrdersAppPage from './apps/work-orders/WorkOrdersAppPage'
import AssetManagementAppPage from './apps/asset-management/AssetManagementAppPage'
import TreeStructureAppPage from './apps/tree-structure/TreeStructureAppPage'
import AssetClassificationsAppPage from './apps/asset-classifications/AssetClassificationsAppPage'
import CostcentersAppPage from './apps/costcenters/CostcentersAppPage'
import UserGroupsAppPage from './apps/user-groups/UserGroupsAppPage'
import TemplateAppPage from './apps/template-app/TemplateAppPage'
import HotkeysAppPage from './apps/hotkeys/HotkeysAppPage'
import TranslationsAppPage from './apps/translations/TranslationsAppPage'

function ProtectedRoute({ children }: { children: ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />
  }
  return children
}

export default function App() {
  return (
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
        path="/translations"
        element={
          <ProtectedRoute>
            <TranslationsAppPage />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

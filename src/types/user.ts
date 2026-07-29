export interface ModuleRights {
  CRM?: 'none' | 'view' | 'edit'
  SERVICES?: 'none' | 'view' | 'edit'
  HR?: 'none' | 'view' | 'edit'
  PROJECTS?: 'none' | 'view' | 'edit'
  FINANCE?: 'none' | 'view' | 'edit'
  SALESENG?: 'none' | 'view' | 'edit'
}

export interface UserProfile {
  id: string
  name: string
  email: string
  role: string
  active: boolean
  companies: string[]
  departments: string[]
  moduleRights: ModuleRights
}

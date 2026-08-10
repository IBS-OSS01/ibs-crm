/**
 * Enterprise Permission Engine
 * India Business Suite (IBS)
 */

export type PermissionLevel = 'none' | 'view' | 'edit'

export interface ModuleRights {
  CRM?: PermissionLevel
  SERVICES?: PermissionLevel
  HR?: PermissionLevel
  PROJECTS?: PermissionLevel
  FINANCE?: PermissionLevel
  SALESENG?: PermissionLevel
}

export class PermissionEngine {
  /**
   * Returns true if the user can at least view the module.
   */
  static canView(
    rights: ModuleRights = {},
    module: keyof ModuleRights
  ): boolean {
    return rights[module] === 'view' || rights[module] === 'edit'
  }

  /**
   * Returns true if the user can edit the module.
   */
  static canEdit(
    rights: ModuleRights = {},
    module: keyof ModuleRights
  ): boolean {
    return rights[module] === 'edit'
  }

  /**
   * Returns the exact permission level.
   */
  static getPermission(
    rights: ModuleRights = {},
    module: keyof ModuleRights
  ): PermissionLevel {
    return rights[module] || 'none'
  }

  /**
   * Returns all modules with view/edit access.
   */
  static getAccessibleModules(rights: ModuleRights = {}) {
    return Object.entries(rights)
      .filter(([_, value]) => value !== 'none')
      .map(([module]) => module)
  }

  /**
   * Admin override.
   */
  static isAdmin(role?: string): boolean {
    return role === 'admin'
  }

  /**
   * Final enterprise access check.
   */
  static hasAccess(
    role: string,
    rights: ModuleRights = {},
    module: keyof ModuleRights,
    level: PermissionLevel = 'view'
  ): boolean {
    if (this.isAdmin(role)) return true

    if (level === 'view') {
      return this.canView(rights, module)
    }

    return this.canEdit(rights, module)
  }
}

export default PermissionEngine
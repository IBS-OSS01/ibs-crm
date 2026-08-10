/**
 * Enterprise Role Engine
 * India Business Suite (IBS)
 */

import { ModuleRights } from './PermissionEngine'

export interface RoleDefinition {
  id: string
  name: string
  description?: string
  moduleRights: ModuleRights
  system?: boolean
}

export class RoleEngine {
  private static roles: RoleDefinition[] = []

  static load(roles: RoleDefinition[]) {
    this.roles = roles
  }

  static getAll(): RoleDefinition[] {
    return this.roles
  }

  static get(roleId: string): RoleDefinition | undefined {
    return this.roles.find(r => r.id === roleId)
  }

  static exists(roleId: string): boolean {
    return this.roles.some(r => r.id === roleId)
  }

  static getRights(roleId: string): ModuleRights {
    return this.get(roleId)?.moduleRights ?? {}
  }

  static isSystem(roleId: string): boolean {
    return this.get(roleId)?.system === true
  }

  static add(role: RoleDefinition) {
    this.roles.push(role)
  }

  static update(roleId: string, role: Partial<RoleDefinition>) {
    this.roles = this.roles.map(r =>
      r.id === roleId ? { ...r, ...role } : r
    )
  }

  static remove(roleId: string) {
    this.roles = this.roles.filter(r => r.id !== roleId)
  }
}

export default RoleEngine
/**
 * Backward-compatibility shim.
 *
 * All existing imports of the form:
 *   import { useAuth } from '../context/AuthContext'
 *   import { AuthProvider } from '../../context/AuthContext'
 *
 * continue to work unchanged. The canonical implementation has moved to
 * src/auth/AuthContext.jsx as part of Permission Layer v1.
 *
 * Do NOT add logic here — edit src/auth/AuthContext.jsx instead.
 */
export {
  AuthProvider,
  useAuth,
  useCurrentUser,
  usePermissions,
  MODULES,
  RIGHTS,
} from '../auth/AuthContext'

export { default } from '../auth/AuthContext'

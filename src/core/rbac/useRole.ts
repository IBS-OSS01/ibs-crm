import { useAuth } from '../../context/AuthContext'

export function useRole() {
  const { userProfile } = useAuth()

  return {
    role: userProfile?.role ?? null,
    isAdmin: userProfile?.role === 'admin',
    isManager: userProfile?.role === 'manager',
    profile: userProfile,
  }
}

export default useRole

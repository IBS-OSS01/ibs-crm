import React, { createContext, useContext, useMemo } from 'react'
import { useAuth } from '../../../context/AuthContext'

const UserContext = createContext(null)

export function UserProvider({ children }) {
  const { user, userProfile } = useAuth()

  const value = useMemo(() => ({
    user,
    profile: userProfile
  }), [user, userProfile])

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  )
}

export function useCurrentUser() {
  return useContext(UserContext)
}

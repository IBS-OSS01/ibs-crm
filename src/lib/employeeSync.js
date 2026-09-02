// Shared logic for keeping `users` (app logins) and `hr_employees` (HR
// roster / org chart) in sync. Used by both the HR > Employees "Import from
// App Users" bulk sync and the automatic sync that runs when Admin > Users
// creates a new login.

// Best-effort guess at a department from a role/designation label — only
// used to pre-fill a new record; always editable afterward.
export const guessDepartment = (label = '') => {
  const l = label.toLowerCase()
  if (l.includes('sales')) return 'Sales'
  if (l.includes('service') || l.includes('site')) return 'Delivery'
  if (l.includes('hr')) return 'Admin'
  if (l.includes('admin') || l.includes('general manager') || l.includes('project manager') || l.includes('solution manager')) return 'Management'
  return 'Other'
}

// Builds an hr_employees payload from a real `users` doc. Only fills in
// fields we actually know from the account — name, email, role-as-
// designation, appointed company. Phone, employee number, and reporting
// manager are intentionally left blank rather than guessing real data
// about real people; the caller is expected to prompt for those next.
export function buildEmployeeFromUser(appUser, roleLabel) {
  const designation = roleLabel || ''
  return {
    name: appUser.name || appUser.email, email: appUser.email || '',
    designation, department: guessDepartment(designation),
    phone: '', address: '', emergencyContact: '', joinDate: '', salary: 0,
    active: appUser.active !== false, reportingManagerId: '', employeeNumber: '',
    appointedCompany: appUser.companies?.[0] || '',
    importedFromUserId: appUser.id,
  }
}

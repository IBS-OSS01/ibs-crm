// Who may read / create / update / delete which collection — a port of firestore.rules.
//   P = any signed-in person who has a profile in the `users` collection ("provisioned")
//   A = an admin (users/{uid}.role == 'admin')
// Anything not listed is denied.
const P = 'P', A = 'A'
const open = { read: P, create: P, update: P, delete: P }
const adminWrites = { read: P, create: A, update: A, delete: A }

const OPEN = [
  'tasks',
  'inventory_items', 'inventory_warehouses', 'inventory_stocks', 'inventory_consumption_requests', 'inventory_spare_requests',
  'inventory_stock_adjustments', 'inventory_stock_transfers', 'inventory_reorder_consolidations',
  'crm_customers', 'crm_contacts', 'crm_products', 'crm_orders', 'crm_deals', 'crm_sites', 'crm_tasks',
  'hr_employees', 'hr_attendance', 'hr_leaves', 'hr_salary_slips', 'hr_advances', 'hr_expenses',
  'project_tasks', 'project_service_logs', 'projects', 'project_costs',
  'finance_expenses', 'finance_payments', 'finance_payables', 'finance_vendors', 'finance_hsn_codes', 'finance_invoices', 'finance_bank_accounts',
  'finance_vouchers', 'finance_counters', 'finance_purchase_orders', 'finance_stock_journals', 'finance_tds_sections', 'finance_tds_challans',
  'finance_statutory_challans', 'finance_fx_rates', 'finance_tds_returns', 'finance_gst_challans', 'finance_gstr2b_imports',
  'finance_bank_statement_lines', 'finance_bank_statement_files', 'finance_cost_centres', 'finance_budgets', 'finance_attachments',
]

export const RULES = {
  ...Object.fromEntries(OPEN.map(c => [c, open])),
  users: adminWrites,
  roles: adminWrites,
  crm_targets: adminWrites,
  hr_salary_revisions: adminWrites,
  company_settings: adminWrites,
  finance_accounts: adminWrites,
  finance_journal_entries: adminWrites,
  team_member_requests: { read: P, create: P, update: A, delete: A },
  finance_audit_log: { read: P, create: P, update: false, delete: false },        // append-only
  project_plan_tasks: { read: P, create: 'PM', update: 'PM', delete: 'PM' },       // admin, project manager or sales manager
  public_task_links: { read: 'public', create: P, update: 'LINK', delete: false },  // read by anyone with the link; outsiders may only change status fields
}

export const PUBLIC_LINK_KEYS = ['status', 'statusNote', 'updatedAt']

// ctx: { uid: string|null, provisioned: boolean, role: string|null }; extra.changedKeys is used by the public-link rule
export function allowed(col, action, ctx, extra = {}) {
  const rule = RULES[col]
  if (!rule) return false
  const need = rule[action]
  if (!need) return false
  const signedIn = !!ctx?.uid, provisioned = signedIn && !!ctx.provisioned, admin = provisioned && ctx.role === 'admin'
  switch (need) {
    case 'public': return true
    case P: return provisioned
    case A: return admin
    case 'PM': return provisioned && (admin || ctx.role === 'project_manager' || ctx.role === 'sales_manager')
    case 'LINK': return (extra.changedKeys || []).every(k => PUBLIC_LINK_KEYS.includes(k))
    default: return false
  }
}

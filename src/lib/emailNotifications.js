/**
 * EmailJS notification utility — task assigned & task completed emails
 *
 * ─── EMAILJS DASHBOARD FIX (do this once — this is why mails go to operations@) ───
 *
 * Go to https://dashboard.emailjs.com → Email Templates
 *
 * For BOTH templates (template_0op9m3x AND template_514dw5r):
 *
 *   1. "To Email" field  →  change from operations@udishtha.com  to  {{to_email}}
 *      (This is the root cause — currently hardcoded, must be dynamic)
 *
 *   2. "From Name" field →  set to:  IBS Notifications
 *      (Makes the sender appear as "IBS Notifications" instead of gmail account name)
 *
 *   3. "Reply To" field  →  set to:  no-reply@udishtha.com
 *      (Makes replies non-deliverable — acts as a no-reply address)
 *
 *   4. Save each template.
 *
 * ─── TEMPLATE CONTENT (reference) ───────────────────────────────────────────
 *
 *    Template A  template_0op9m3x — "task_assigned"
 *    Subject:  📋 New task assigned to you: {{task_title}}
 *    Body:
 *      Hi {{to_name}},
 *
 *      You have been assigned a new task on IBS CRM:
 *
 *      Task      : {{task_title}}
 *      Deal      : {{deal_name}}
 *      Details   : {{task_description}}
 *      Deadline  : {{deadline}}
 *      Priority  : {{priority}}
 *      Assigned by: {{requested_by}}
 *
 *      Please log in to accept or propose an alternative date:
 *      {{app_url}}
 *
 *      — IBS Notifications (do not reply to this email)
 *
 *    Template B  template_514dw5r — "task_completed"
 *    Subject:  ✅ Task completed: {{task_title}}
 *    Body:
 *      Hi {{to_name}},
 *
 *      A task you created has been marked as completed:
 *
 *      Task         : {{task_title}}
 *      Deal         : {{deal_name}}
 *      Completed by : {{completed_by}}
 *      Completed on : {{completed_date}}
 *
 *      {{app_url}}
 *
 *      — IBS Notifications (do not reply to this email)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ──────────────── FILL THESE IN ──────────────────────────────────────────────
const EMAILJS_PUBLIC_KEY   = '3uqAo5easMGfnJi78'          // Account → API Keys
const EMAILJS_SERVICE_ID   = 'service_nanuhzc'            // Email Services tab
const TEMPLATE_TASK_ASSIGNED  = 'template_0op9m3x'        // Task assigned template
const TEMPLATE_TASK_COMPLETED = 'template_514dw5r'        // Task completed template
// ─────────────────────────────────────────────────────────────────────────────

const APP_URL = 'https://uipl-erp.web.app'

let _initialised = false

async function getEmailJS() {
  if (!_initialised) {
    const emailjs = await import('@emailjs/browser')
    emailjs.init({ publicKey: EMAILJS_PUBLIC_KEY })
    _initialised = true
    return emailjs
  }
  const emailjs = await import('@emailjs/browser')
  return emailjs
}

function isConfigured() {
  return (
    EMAILJS_PUBLIC_KEY   !== 'YOUR_EMAILJS_PUBLIC_KEY' &&
    EMAILJS_SERVICE_ID   !== 'YOUR_SERVICE_ID'
  )
}

/**
 * Send email when a task is assigned to someone.
 * @param {Object} task - the newly created task document
 * @param {string} toEmail - assignee's email address
 */
export async function notifyTaskAssigned(task, toEmail) {
  if (!toEmail || !isConfigured()) {
    if (!isConfigured()) console.info('[EmailJS] Not configured — skipping task-assigned notification')
    return
  }
  try {
    const emailjs = await getEmailJS()
    await emailjs.send(EMAILJS_SERVICE_ID, TEMPLATE_TASK_ASSIGNED, {
      // Routing — template "To Email" field must be set to {{to_email}} in EmailJS dashboard
      to_name:          task.assignedToName  || 'Team Member',
      to_email:         toEmail,
      // Sender display — template "From Name" must be set to {{from_name}} or fixed "IBS Notifications"
      from_name:        'IBS Notifications',
      reply_to:         'no-reply@udishtha.com',
      // Content
      task_title:       task.title,
      task_description: task.description    || '(no details)',
      deal_name:        task.dealTitle      || 'N/A',
      requested_by:     task.requestedByName || 'CRM User',
      deadline:         task.requestedDate  || '—',
      priority:         (task.priority || 'medium').replace('_', ' ').replace(/^\w/, c => c.toUpperCase()),
      app_url:          APP_URL,
    })
    console.info('[EmailJS] Task-assigned email sent to', toEmail)
  } catch (err) {
    console.warn('[EmailJS] Failed to send task-assigned email:', err.text || err.message || err)
  }
}

/**
 * Send email when a task is marked as completed.
 * @param {Object} task - the completed task document
 * @param {string} toEmail - task creator's email address
 */
export async function notifyTaskCompleted(task, toEmail) {
  if (!toEmail || !isConfigured()) {
    if (!isConfigured()) console.info('[EmailJS] Not configured — skipping task-completed notification')
    return
  }
  try {
    const emailjs = await getEmailJS()
    await emailjs.send(EMAILJS_SERVICE_ID, TEMPLATE_TASK_COMPLETED, {
      // Routing — template "To Email" field must be set to {{to_email}} in EmailJS dashboard
      to_name:        task.requestedByName  || 'Team Member',
      to_email:       toEmail,
      // Sender display
      from_name:      'IBS Notifications',
      reply_to:       'no-reply@udishtha.com',
      // Content
      task_title:     task.title,
      deal_name:      task.dealTitle        || 'N/A',
      completed_by:   task.assignedToName   || 'Assignee',
      completed_date: new Date().toLocaleDateString('en-IN'),
      app_url:        APP_URL,
    })
    console.info('[EmailJS] Task-completed email sent to', toEmail)
  } catch (err) {
    console.warn('[EmailJS] Failed to send task-completed email:', err.text || err.message || err)
  }
}

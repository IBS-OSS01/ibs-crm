/**
 * Project plan task email notifications via EmailJS.
 *
 * TWO NEW TEMPLATES NEEDED in EmailJS → Email Templates:
 *
 * Template A — "project_task_assigned"
 * Subject: 📋 Project task assigned to you: {{task_title}}
 * Body (HTML):
 *   Hi {{to_name}},<br><br>
 *   A project task has been assigned to you via IBS CRM.<br><br>
 *   <b>Task:</b> {{task_title}}<br>
 *   <b>Project:</b> {{project_name}}<br>
 *   <b>WBS Code:</b> {{wbs_code}}<br>
 *   <b>Deadline:</b> {{deadline}}<br><br>
 *   Click the button below to view your task and update its status
 *   — no login required:<br><br>
 *   <a href="{{task_link}}" style="background:#1D4ED8;color:#fff;padding:10px 20px;
 *   border-radius:8px;text-decoration:none;font-weight:700;">View & Update Task →</a>
 *
 * Template B — "project_task_reminder"
 * Subject: ⏰ Task due tomorrow: {{task_title}}
 * Body (HTML):
 *   Hi {{to_name}},<br><br>
 *   This is a reminder that the following project task is due <b>tomorrow</b>.<br><br>
 *   <b>Task:</b> {{task_title}}<br>
 *   <b>Project:</b> {{project_name}}<br>
 *   <b>Deadline:</b> {{deadline}}<br><br>
 *   Please update your task status now:<br><br>
 *   <a href="{{task_link}}" style="background:#d97706;color:#fff;padding:10px 20px;
 *   border-radius:8px;text-decoration:none;font-weight:700;">Update Task Status →</a>
 *
 * After creating both templates, paste the IDs below:
 */

const EMAILJS_PUBLIC_KEY      = '3uqAo5easMGfnJi78'
const EMAILJS_SERVICE_ID      = 'service_nanuhzc'
const TEMPLATE_PROJ_ASSIGNED  = 'YOUR_PROJECT_ASSIGNED_TEMPLATE_ID'   // ← fill this
const TEMPLATE_PROJ_REMINDER  = 'YOUR_PROJECT_REMINDER_TEMPLATE_ID'   // ← fill this

const APP_URL = 'https://uipl-erp.web.app'

let _init = false
async function getEJS() {
  const ejs = await import('@emailjs/browser')
  if (!_init) { ejs.init({ publicKey: EMAILJS_PUBLIC_KEY }); _init = true }
  return ejs
}

function configured(tmpl) {
  return tmpl && !tmpl.startsWith('YOUR_') && EMAILJS_SERVICE_ID !== 'YOUR_SERVICE_ID'
}

/**
 * Notify a resource that they have been assigned a project plan task.
 * Called when a resource email is added to a WBS task.
 */
export async function notifyProjectTaskAssigned({ taskTitle, wbsCode, projectName, deadline, token, toEmail }) {
  if (!toEmail || !configured(TEMPLATE_PROJ_ASSIGNED)) {
    console.info('[ProjectEmail] Task-assigned template not configured — skipping')
    return
  }
  try {
    const ejs = await getEJS()
    await ejs.send(EMAILJS_SERVICE_ID, TEMPLATE_PROJ_ASSIGNED, {
      to_name:      toEmail.split('@')[0],
      to_email:     toEmail,
      task_title:   taskTitle,
      project_name: projectName,
      wbs_code:     wbsCode || '—',
      deadline:     deadline || '—',
      task_link:    `${APP_URL}/task-view/${token}`,
    })
    console.info('[ProjectEmail] Task-assigned sent to', toEmail)
  } catch (e) {
    console.warn('[ProjectEmail] Failed to send task-assigned:', e.text || e.message)
  }
}

/**
 * Send a day-before deadline reminder.
 * Called client-side on app load when a task is due tomorrow and not completed.
 */
export async function sendProjectTaskReminder({ taskTitle, projectName, deadline, token, toEmail }) {
  if (!toEmail || !configured(TEMPLATE_PROJ_REMINDER)) {
    console.info('[ProjectEmail] Reminder template not configured — skipping')
    return
  }
  try {
    const ejs = await getEJS()
    await ejs.send(EMAILJS_SERVICE_ID, TEMPLATE_PROJ_REMINDER, {
      to_name:      toEmail.split('@')[0],
      to_email:     toEmail,
      task_title:   taskTitle,
      project_name: projectName,
      deadline:     deadline || '—',
      task_link:    `${APP_URL}/task-view/${token}`,
    })
    console.info('[ProjectEmail] Reminder sent to', toEmail)
  } catch (e) {
    console.warn('[ProjectEmail] Failed to send reminder:', e.text || e.message)
  }
}

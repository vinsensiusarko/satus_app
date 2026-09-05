// AuditService.gs

function auditLog(userId, role, action, referenceId, description) {
  try {
    const logId = 'LOG-' + Date.now();
    const now = new Date();
    appendRow(CONFIG.SHEETS.AUDIT_LOG, [
      logId, now, userId, role, action, referenceId, description
    ]);
  } catch(e) {
    // Fail silently so it doesn't break main flow, but in production we'd want to handle this
    console.error('Audit Log failed: ' + e.message);
  }
}

function getAuditLogs(token) {
  try {
    requireRole(token, [CONFIG.ROLES.MANAGER]);
    return { success: true, data: getSheetData(CONFIG.SHEETS.AUDIT_LOG).reverse().slice(0, 100) };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

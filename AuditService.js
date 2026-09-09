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
    const rawData = getSheetData(CONFIG.SHEETS.AUDIT_LOG) || [];
    const sorted = rawData.slice().sort((a, b) => {
      const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return (isNaN(tB) ? 0 : tB) - (isNaN(tA) ? 0 : tA);
    });
    return { success: true, data: sorted.slice(0, 200) };
  } catch (error) {
    if (error.message.includes("Unauthorized")) throw error; return { success: false, message: error.message };
  }
}

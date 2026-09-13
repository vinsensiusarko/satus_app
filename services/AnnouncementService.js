// services/AnnouncementService.js
// Layanan Pengumuman Multi-Platform untuk SATUS Web & Mobile

/**
 * Memastikan sheet Announcements tersedia di spreadsheet
 */
function ensureAnnouncementSheet() {
  const sheetName = (CONFIG.SHEETS && CONFIG.SHEETS.ANNOUNCEMENTS) || 'Announcements';
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = [
      'id', 'author_id', 'author_name', 'author_role', 'title', 
      'content', 'target_role', 'is_pinned', 'created_at'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#7C3AED').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Membuat pengumuman baru dari Web Manager / Kasir atau Mobile App
 */
function createAnnouncement(token, params) {
  try {
    const auth = verifyToken(token);
    if (!auth.valid) {
      return { success: false, message: 'Autentikasi gagal: ' + auth.error };
    }

    const role = String(auth.user.role || '').toUpperCase();
    if (role !== CONFIG.ROLES.MANAGER && role !== CONFIG.ROLES.KASIR && role !== 'ADMIN') {
      return { success: false, message: 'Akses ditolak: Hanya Manager atau Kasir yang dapat membuat pengumuman' };
    }

    const title = String(params.title || 'Pengumuman Resmi').trim();
    const content = String(params.content || params.message || params.body || '').trim();
    const targetRole = String(params.targetRole || params.target_role || 'SISWA').toUpperCase();
    const isPinned = params.isPinned === true || String(params.isPinned).toLowerCase() === 'true';

    if (!content) {
      return { success: false, message: 'Isi pengumuman tidak boleh kosong' };
    }

    const sheet = ensureAnnouncementSheet();
    const announcementId = 'ANN-' + Date.now();
    const createdAt = new Date().toISOString();

    sheet.appendRow([
      announcementId,
      auth.user.user_id || auth.user.userId || '',
      auth.user.nama || auth.user.name || 'Staf',
      role,
      title,
      content,
      targetRole,
      isPinned ? 'TRUE' : 'FALSE',
      createdAt
    ]);

    // Picu FCM Push Notification ke target role
    try {
      sendBroadcastNotification(
        '📢 ' + title,
        content,
        targetRole === 'ALL' ? null : targetRole
      );
    } catch (e) {
      Logger.log('Warning saat memicu push notification pengumuman: ' + e.message);
    }

    // Catat ke Audit Log
    try {
      logAudit(auth.user.user_id || auth.user.userId, 'CREATE_ANNOUNCEMENT', 'Pengumuman: ' + title + ' (' + announcementId + ')');
    } catch (_) {}

    return {
      success: true,
      message: 'Pengumuman berhasil diterbitkan dan disiarkan ke pengguna',
      data: {
        id: announcementId,
        title: title,
        content: content,
        targetRole: targetRole,
        isPinned: isPinned,
        createdAt: createdAt
      }
    };
  } catch (err) {
    return {
      success: false,
      message: 'Gagal membuat pengumuman: ' + err.message
    };
  }
}

/**
 * Mengambil daftar pengumuman untuk ditampilkan di Web / Mobile
 */
function getAnnouncements(token, params) {
  try {
    const sheet = ensureAnnouncementSheet();
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      return { success: true, data: [] };
    }

    const headers = data[0];
    const results = [];

    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const item = {};
      for (let j = 0; j < headers.length; j++) {
        item[headers[j]] = row[j];
      }
      results.push(item);
    }

    // Urutkan dari yang terbaru
    results.reverse();

    return {
      success: true,
      data: results
    };
  } catch (err) {
    return {
      success: false,
      message: 'Gagal memuat pengumuman: ' + err.message
    };
  }
}

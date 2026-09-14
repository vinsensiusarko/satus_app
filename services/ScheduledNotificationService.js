// services/ScheduledNotificationService.js
// Layanan Pengelolaan dan Otomasi Notifikasi Terjadwal (Scheduled Push Notifications)

/**
 * Memastikan sheet Scheduled_Notifications tersedia di spreadsheet dan memiliki kolom standar
 */
function ensureScheduledNotificationsSheet() {
  const sheetName = (CONFIG.SHEETS && CONFIG.SHEETS.SCHEDULED_NOTIFICATIONS) || 'Scheduled_Notifications';
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = (typeof DATABASE_SCHEMAS !== 'undefined' && DATABASE_SCHEMAS[sheetName]) || [
      'schedule_id', 'title', 'body', 'target_role', 'trigger_time', 'frequency', 'is_active', 'last_sent_at', 'created_by', 'created_at'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#10B981').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  } else {
    ensureSheetHeaders(sheet, sheetName);
  }

  // Jika baris hanya header, tambahkan 1 template jadwal default (Pagi jam 06:00)
  if (sheet.getLastRow() <= 1) {
    sheet.appendRow([
      'SCHED_PAGI_0600',
      '🌱 Selamat Pagi Warga SATUS!',
      'Awali hari dengan pilah sampah plastik & botol dari rumah. Setorkan ke Bank Sampah SATUS hari ini dan tukarkan dengan saldo hijau!',
      'all_users',
      '06:00',
      'DAILY',
      'TRUE',
      '',
      'SYSTEM',
      new Date().toISOString()
    ]);
  }

  return sheet;
}

/**
 * Mengambil seluruh jadwal notifikasi (Hanya untuk Manager)
 */
function getScheduledNotifications(token) {
  try {
    const session = verifyToken(token);
    if (!session) {
      return { success: false, error_code: 'UNAUTHORIZED', message: 'Sesi login telah berakhir' };
    }
    if (session.role !== CONFIG.ROLES.MANAGER) {
      return { success: false, error_code: 'FORBIDDEN', message: 'Akses ditolak. Hanya Manager yang dapat melihat jadwal notifikasi.' };
    }

    ensureScheduledNotificationsSheet();
    const sheetData = getSheetData((CONFIG.SHEETS && CONFIG.SHEETS.SCHEDULED_NOTIFICATIONS) || 'Scheduled_Notifications');

    const list = sheetData.map(function(row) {
      return {
        schedule_id: String(row.schedule_id || ''),
        title: String(row.title || ''),
        body: String(row.body || ''),
        target_role: String(row.target_role || 'all_users'),
        trigger_time: String(row.trigger_time || '06:00'),
        frequency: String(row.frequency || 'DAILY'),
        is_active: String(row.is_active).toUpperCase() === 'TRUE' || row.is_active === true,
        last_sent_at: row.last_sent_at || null,
        created_by: String(row.created_by || ''),
        created_at: row.created_at || ''
      };
    });

    return {
      success: true,
      message: 'Daftar jadwal notifikasi berhasil dimuat',
      data: list
    };
  } catch (err) {
    console.error('getScheduledNotifications error:', err);
    return { success: false, message: 'Gagal memuat jadwal notifikasi: ' + err.message };
  }
}

/**
 * Menyimpan atau memperbarui jadwal notifikasi
 */
function saveScheduledNotification(token, data) {
  try {
    const session = verifyToken(token);
    if (!session) {
      return { success: false, error_code: 'UNAUTHORIZED', message: 'Sesi login telah berakhir' };
    }
    if (session.role !== CONFIG.ROLES.MANAGER) {
      return { success: false, error_code: 'FORBIDDEN', message: 'Akses ditolak. Hanya Manager yang dapat mengelola jadwal notifikasi.' };
    }

    data = data || {};
    const title = String(data.title || '').trim();
    const body = String(data.body || '').trim();
    const targetRole = String(data.target_role || 'all_users').trim();
    const triggerTime = String(data.trigger_time || '06:00').trim();
    const frequency = String(data.frequency || 'DAILY').trim().toUpperCase();
    const isActive = data.is_active !== false && String(data.is_active).toUpperCase() !== 'FALSE';

    if (!title || !body) {
      return { success: false, message: 'Judul dan isi pesan notifikasi wajib diisi' };
    }

    ensureScheduledNotificationsSheet();
    const sheetName = (CONFIG.SHEETS && CONFIG.SHEETS.SCHEDULED_NOTIFICATIONS) || 'Scheduled_Notifications';
    const sheet = getSheet(sheetName);
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];

    const idColIdx = headers.indexOf('schedule_id');
    const titleColIdx = headers.indexOf('title');
    const bodyColIdx = headers.indexOf('body');
    const targetRoleColIdx = headers.indexOf('target_role');
    const triggerTimeColIdx = headers.indexOf('trigger_time');
    const freqColIdx = headers.indexOf('frequency');
    const activeColIdx = headers.indexOf('is_active');
    const lastSentColIdx = headers.indexOf('last_sent_at');
    const createdByColIdx = headers.indexOf('created_by');
    const createdAtColIdx = headers.indexOf('created_at');

    let scheduleId = String(data.schedule_id || '').trim();
    let foundRowIdx = -1;

    if (scheduleId) {
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][idColIdx]).trim() === scheduleId) {
          foundRowIdx = i + 1; // 1-indexed
          break;
        }
      }
    }

    const nowIso = new Date().toISOString();

    if (foundRowIdx > 0) {
      // Update existing row
      sheet.getRange(foundRowIdx, titleColIdx + 1).setValue(title);
      sheet.getRange(foundRowIdx, bodyColIdx + 1).setValue(body);
      sheet.getRange(foundRowIdx, targetRoleColIdx + 1).setValue(targetRole);
      sheet.getRange(foundRowIdx, triggerTimeColIdx + 1).setValue(triggerTime);
      sheet.getRange(foundRowIdx, freqColIdx + 1).setValue(frequency);
      sheet.getRange(foundRowIdx, activeColIdx + 1).setValue(isActive ? 'TRUE' : 'FALSE');
    } else {
      // Create new row
      scheduleId = 'SCHED_' + Utilities.getUuid().substring(0, 8).toUpperCase();
      const newRow = [];
      newRow[idColIdx] = scheduleId;
      newRow[titleColIdx] = title;
      newRow[bodyColIdx] = body;
      newRow[targetRoleColIdx] = targetRole;
      newRow[triggerTimeColIdx] = triggerTime;
      newRow[freqColIdx] = frequency;
      newRow[activeColIdx] = isActive ? 'TRUE' : 'FALSE';
      newRow[lastSentColIdx] = '';
      newRow[createdByColIdx] = session.user_id || session.nama || 'MANAGER';
      newRow[createdAtColIdx] = nowIso;
      sheet.appendRow(newRow);
    }

    return {
      success: true,
      message: 'Jadwal notifikasi berhasil disimpan',
      data: { schedule_id: scheduleId }
    };
  } catch (err) {
    console.error('saveScheduledNotification error:', err);
    return { success: false, message: 'Gagal menyimpan jadwal notifikasi: ' + err.message };
  }
}

/**
 * Menghapus jadwal notifikasi
 */
function deleteScheduledNotification(token, scheduleId) {
  try {
    const session = verifyToken(token);
    if (!session) {
      return { success: false, error_code: 'UNAUTHORIZED', message: 'Sesi login telah berakhir' };
    }
    if (session.role !== CONFIG.ROLES.MANAGER) {
      return { success: false, error_code: 'FORBIDDEN', message: 'Akses ditolak. Hanya Manager yang dapat menghapus jadwal notifikasi.' };
    }

    if (!scheduleId) {
      return { success: false, message: 'ID jadwal tidak valid' };
    }

    const sheetName = (CONFIG.SHEETS && CONFIG.SHEETS.SCHEDULED_NOTIFICATIONS) || 'Scheduled_Notifications';
    const sheet = getSheet(sheetName);
    if (!sheet) return { success: false, message: 'Sheet jadwal tidak ditemukan' };

    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const idColIdx = headers.indexOf('schedule_id');

    let targetRow = -1;
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idColIdx]).trim() === String(scheduleId).trim()) {
        targetRow = i + 1;
        break;
      }
    }

    if (targetRow > 0) {
      sheet.deleteRow(targetRow);
      return { success: true, message: 'Jadwal notifikasi berhasil dihapus' };
    }

    return { success: false, message: 'Jadwal notifikasi tidak ditemukan' };
  } catch (err) {
    console.error('deleteScheduledNotification error:', err);
    return { success: false, message: 'Gagal menghapus jadwal: ' + err.message };
  }
}

/**
 * Mengirimkan notifikasi terjadwal sekarang juga (Tes Cepat / Manual Trigger)
 */
function sendScheduledNotificationNow(token, scheduleId) {
  try {
    const session = verifyToken(token);
    if (!session) {
      return { success: false, error_code: 'UNAUTHORIZED', message: 'Sesi login telah berakhir' };
    }
    if (session.role !== CONFIG.ROLES.MANAGER) {
      return { success: false, error_code: 'FORBIDDEN', message: 'Akses ditolak.' };
    }

    ensureScheduledNotificationsSheet();
    const sheetData = getSheetData((CONFIG.SHEETS && CONFIG.SHEETS.SCHEDULED_NOTIFICATIONS) || 'Scheduled_Notifications');
    const sched = sheetData.find(function(r) {
      return String(r.schedule_id).trim() === String(scheduleId).trim();
    });

    if (!sched) {
      return { success: false, message: 'Jadwal notifikasi tidak ditemukan' };
    }

    const targetTopic = sched.target_role === 'role_siswa' ? 'role_siswa' : 'all_users';
    const channel = (CONFIG.FIREBASE && CONFIG.FIREBASE.CHANNELS && CONFIG.FIREBASE.CHANNELS.INFO) || 'satus_info_channel';

    const sendRes = sendFcmTopicMessage(
      targetTopic,
      sched.title,
      sched.body,
      {
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
        type: 'SCHEDULED_ANNOUNCEMENT',
        target_role: sched.target_role,
        schedule_id: sched.schedule_id
      },
      channel
    );

    // Update last_sent_at
    const sheet = getSheet((CONFIG.SHEETS && CONFIG.SHEETS.SCHEDULED_NOTIFICATIONS) || 'Scheduled_Notifications');
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const idColIdx = headers.indexOf('schedule_id');
    const lastSentColIdx = headers.indexOf('last_sent_at');

    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][idColIdx]).trim() === String(scheduleId).trim()) {
        sheet.getRange(i + 1, lastSentColIdx + 1).setValue(new Date().toISOString());
        break;
      }
    }

    return {
      success: sendRes.success,
      message: sendRes.success ? 'Push notifikasi berhasil dikirim ke topik: ' + targetTopic : (sendRes.message || 'Gagal mengirim notifikasi via FCM')
    };
  } catch (err) {
    console.error('sendScheduledNotificationNow error:', err);
    return { success: false, message: 'Gagal memicu pengiriman notifikasi: ' + err.message };
  }
}

/**
 * Worker otomatis: Dijalankan oleh Time-Driven Trigger Google Apps Script setiap 1 jam
 * Mengecek apakah ada jadwal aktif yang jamnya cocok dengan jam saat ini (WIB / GMT+7)
 */
function checkAndSendScheduledNotifications() {
  try {
    ensureScheduledNotificationsSheet();
    const sheetData = getSheetData((CONFIG.SHEETS && CONFIG.SHEETS.SCHEDULED_NOTIFICATIONS) || 'Scheduled_Notifications');
    if (!sheetData || sheetData.length === 0) return;

    // Hitung waktu saat ini dalam WIB (UTC+7)
    const now = new Date();
    const wibOffset = 7 * 60 * 60 * 1000;
    const wibTime = new Date(now.getTime() + (now.getTimezoneOffset() * 60000) + wibOffset);
    const currentHourStr = String(wibTime.getHours()).padStart(2, '0'); // '06'

    sheetData.forEach(function(sched) {
      const isActive = String(sched.is_active).toUpperCase() === 'TRUE' || sched.is_active === true;
      if (!isActive) return;

      const schedTime = String(sched.trigger_time || '').trim(); // misal '06:00'
      const schedHour = schedTime.split(':')[0] || '06';

      if (schedHour === currentHourStr) {
        // Periksa apakah sudah terkirim hari ini untuk mencegah pengiriman dobel di jam yang sama
        if (sched.last_sent_at) {
          const lastSent = new Date(sched.last_sent_at);
          const lastSentWib = new Date(lastSent.getTime() + (lastSent.getTimezoneOffset() * 60000) + wibOffset);
          if (lastSentWib.toDateString() === wibTime.toDateString()) {
            return; // Sudah dikirim hari ini
          }
        }

        const targetTopic = sched.target_role === 'role_siswa' ? 'role_siswa' : 'all_users';
        const channel = (CONFIG.FIREBASE && CONFIG.FIREBASE.CHANNELS && CONFIG.FIREBASE.CHANNELS.INFO) || 'satus_info_channel';

        sendFcmTopicMessage(
          targetTopic,
          sched.title,
          sched.body,
          {
            click_action: 'FLUTTER_NOTIFICATION_CLICK',
            type: 'SCHEDULED_ANNOUNCEMENT',
            target_role: sched.target_role,
            schedule_id: sched.schedule_id
          },
          channel
        );

        // Update timestamp last_sent_at
        const sheet = getSheet((CONFIG.SHEETS && CONFIG.SHEETS.SCHEDULED_NOTIFICATIONS) || 'Scheduled_Notifications');
        const rows = sheet.getDataRange().getValues();
        const headers = rows[0];
        const idColIdx = headers.indexOf('schedule_id');
        const lastSentColIdx = headers.indexOf('last_sent_at');

        for (let i = 1; i < rows.length; i++) {
          if (String(rows[i][idColIdx]).trim() === String(sched.schedule_id).trim()) {
            sheet.getRange(i + 1, lastSentColIdx + 1).setValue(new Date().toISOString());
            break;
          }
        }
      }
    });
  } catch (err) {
    console.error('checkAndSendScheduledNotifications worker error:', err);
  }
}

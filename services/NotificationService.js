// NotificationService.gs
// Modul Pengiriman Push Notification Firebase Cloud Messaging (FCM) untuk SATUS Mobile

/**
 * Membersihkan karakter ilegal untuk nama topik FCM ([a-zA-Z0-9-_.~%]+)
 */
function sanitizeFcmTopic(input) {
  if (!input) return '';
  return String(input).trim().replace(/[^a-zA-Z0-9-_.~%]/g, '_');
}

/**
 * Format angka nominal ke format Rupiah standar (contoh: Rp 50.000)
 */
function formatRupiahCurrency(amount) {
  const num = Math.round(Number(amount) || 0);
  return 'Rp ' + num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/**
 * Mengambil dan memvalidasi kredensial Firebase Service Account dari Script Properties
 */
function getFcmServiceAccountDetails() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const saJson = scriptProperties.getProperty('FIREBASE_SERVICE_ACCOUNT');
  const clientEmailProp = scriptProperties.getProperty('FIREBASE_CLIENT_EMAIL');
  const privateKeyProp = scriptProperties.getProperty('FIREBASE_PRIVATE_KEY');

  let clientEmail = clientEmailProp || '';
  let privateKey = privateKeyProp || '';
  let projectId = (CONFIG.FIREBASE && CONFIG.FIREBASE.PROJECT_ID) ? CONFIG.FIREBASE.PROJECT_ID : 'satus-mobile-mhsm1';
  let isJsonSource = false;

  if (saJson && saJson.trim().length > 0) {
    try {
      const parsed = JSON.parse(saJson);
      isJsonSource = true;
      if (parsed.client_email) clientEmail = parsed.client_email;
      if (parsed.private_key) privateKey = parsed.private_key;
      if (parsed.project_id) projectId = parsed.project_id;
    } catch (e) {
      return {
        valid: false,
        error: 'Format JSON pada properti FIREBASE_SERVICE_ACCOUNT tidak valid: ' + e.message,
        clientEmail: '',
        privateKey: '',
        projectId: projectId
      };
    }
  }

  if (!clientEmail || !privateKey) {
    return {
      valid: false,
      error: 'Kredensial Service Account belum lengkap. Pastikan client_email dan private_key terisi di Script Properties.',
      clientEmail: clientEmail,
      privateKey: privateKey,
      projectId: projectId
    };
  }

  return {
    valid: true,
    isJsonSource: isJsonSource,
    clientEmail: clientEmail,
    privateKey: privateKey.replace(/\\n/g, '\n'),
    projectId: projectId
  };
}

/**
 * Mendapatkan OAuth2 Access Token untuk Firebase Cloud Messaging HTTP v1 API
 * Menggunakan CacheService untuk menyimpan token selama 55 menit.
 * Mengembalikan objek: { success: boolean, token?: string, projectId?: string, error?: string }
 */
function getFcmAccessToken(forceRefresh) {
  const cache = CacheService.getScriptCache();
  if (!forceRefresh) {
    const cachedToken = cache.get('FCM_ACCESS_TOKEN');
    if (cachedToken) {
      const cachedProject = cache.get('FCM_PROJECT_ID') || ((CONFIG.FIREBASE && CONFIG.FIREBASE.PROJECT_ID) ? CONFIG.FIREBASE.PROJECT_ID : 'satus-mobile-mhsm1');
      return { success: true, token: cachedToken, projectId: cachedProject };
    }
  }

  const saDetails = getFcmServiceAccountDetails();
  if (!saDetails.valid) {
    return { success: false, error: saDetails.error, projectId: saDetails.projectId };
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };

    const claim = {
      iss: saDetails.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const encodedHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=+$/, '');
    const encodedClaim = Utilities.base64EncodeWebSafe(JSON.stringify(claim)).replace(/=+$/, '');
    const unsignedJwt = encodedHeader + '.' + encodedClaim;

    let signature;
    try {
      signature = Utilities.computeRsaSha256Signature(unsignedJwt, saDetails.privateKey);
    } catch (sigErr) {
      return {
        success: false,
        error: 'Gagal membuat tanda tangan digital RSA: ' + sigErr.message + '. Pastikan private_key utuh dari -----BEGIN PRIVATE KEY----- hingga -----END PRIVATE KEY-----.',
        projectId: saDetails.projectId
      };
    }

    const encodedSignature = Utilities.base64EncodeWebSafe(signature).replace(/=+$/, '');
    const jwt = unsignedJwt + '.' + encodedSignature;

    const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
      method: 'post',
      contentType: 'application/x-www-form-urlencoded',
      payload: {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
      },
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const content = response.getContentText();
    let resJson = {};
    try {
      resJson = JSON.parse(content);
    } catch (_) {}

    if (statusCode >= 200 && statusCode < 300 && resJson.access_token) {
      cache.put('FCM_ACCESS_TOKEN', resJson.access_token, 3300); // 55 menit
      cache.put('FCM_PROJECT_ID', saDetails.projectId, 3300);
      return { success: true, token: resJson.access_token, projectId: saDetails.projectId };
    } else {
      const errDetail = resJson.error_description || resJson.error || content;
      return {
        success: false,
        error: 'Google OAuth token ditolak (HTTP ' + statusCode + '): ' + errDetail,
        projectId: saDetails.projectId,
        rawResponse: content
      };
    }
  } catch (e) {
    return {
      success: false,
      error: 'Exception saat pertukaran token OAuth2 dengan Google: ' + e.message,
      projectId: saDetails.projectId
    };
  }
}

/**
 * Mengirim pesan FCM ke Topic tertentu via HTTP v1 API
 */
function sendFcmTopicMessage(topic, title, body, dataPayload, channelId) {
  if (!CONFIG.FIREBASE || !CONFIG.FIREBASE.ENABLED) {
    return { success: false, message: 'Fitur notifikasi Firebase dinonaktifkan di Config.js (CONFIG.FIREBASE.ENABLED = false)' };
  }

  const cleanTopic = sanitizeFcmTopic(topic);
  if (!cleanTopic) {
    return { success: false, message: 'Topik notifikasi tidak valid atau bernilai kosong' };
  }

  const targetChannel = channelId || (CONFIG.FIREBASE.CHANNELS ? CONFIG.FIREBASE.CHANNELS.TRANSAKSI : 'satus_transaksi_channel');

  // Pastikan seluruh values di dataPayload bertipe String
  const stringData = {};
  if (dataPayload && typeof dataPayload === 'object') {
    Object.keys(dataPayload).forEach(function(key) {
      stringData[key] = String(dataPayload[key] !== undefined && dataPayload[key] !== null ? dataPayload[key] : '');
    });
  }
  stringData.channel_id = targetChannel;

  // 1. Dapatkan token akses OAuth2 untuk FCM HTTP v1
  const authRes = getFcmAccessToken();
  if (authRes.success && authRes.token) {
    const projectId = authRes.projectId || 'satus-mobile-mhsm1';
    try {
      const v1Payload = {
        message: {
          topic: cleanTopic,
          notification: {
            title: title,
            body: body
          },
          data: stringData,
          android: {
            priority: 'HIGH',
            notification: {
              channel_id: targetChannel,
              default_sound: true,
              default_vibrate_timings: true
            }
          }
        }
      };

      const response = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send', {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: 'Bearer ' + authRes.token
        },
        payload: JSON.stringify(v1Payload),
        muteHttpExceptions: true
      });

      const statusCode = response.getResponseCode();
      const content = response.getContentText();

      if (statusCode >= 200 && statusCode < 300) {
        return { success: true, response: JSON.parse(content) };
      } else {
        let errMessage = content;
        try {
          const errObj = JSON.parse(content);
          if (errObj.error && errObj.error.message) {
            errMessage = errObj.error.message;
          }
        } catch (_) {}

        return {
          success: false,
          code: statusCode,
          message: 'FCM v1 API Error (HTTP ' + statusCode + '): ' + errMessage,
          response: content
        };
      }
    } catch (e) {
      return {
        success: false,
        message: 'Exception saat mengirim pesan FCM v1: ' + e.message
      };
    }
  }

  // Jika autentikasi Service Account gagal, kembalikan detail error otentikasi asli
  if (authRes && authRes.error) {
    return {
      success: false,
      message: authRes.error
    };
  }

  // 2. Jika ada yang memasang FIREBASE_SERVER_KEY lama (Deprecated)
  const serverKey = PropertiesService.getScriptProperties().getProperty('FIREBASE_SERVER_KEY');
  if (serverKey) {
    return {
      success: false,
      message: 'FIREBASE_SERVER_KEY (Legacy) sudah dinonaktifkan permanen oleh Google sejak Juni 2024. Harap gunakan FIREBASE_SERVICE_ACCOUNT (FCM HTTP v1).'
    };
  }

  return {
    success: false,
    message: 'Kredensial Firebase belum disimpan di Script Properties. Tambahkan FIREBASE_SERVICE_ACCOUNT berisi JSON Service Account.'
  };
}

/**
 * Notifikasi Transaksi (Setor Tunai, Setor Sampah, Tarik Tunai) ke Siswa/Nasabah
 */
function sendTransactionNotification(memberId, txType, amount, newBalance, txId, details) {
  if (!memberId) return;

  const topic = 'user_' + sanitizeFcmTopic(memberId);
  const formattedAmount = formatRupiahCurrency(amount);
  const formattedBalance = formatRupiahCurrency(newBalance);

  let title = 'Transaksi Berhasil ✨';
  let body = 'Transaksi sebesar ' + formattedAmount + ' telah berhasil diproses.';

  const typeUpper = String(txType || '').toUpperCase();
  if (typeUpper === 'SETOR_TUNAI') {
    title = 'Setor Tunai Berhasil 💰';
    body = 'Setoran tunai sebesar ' + formattedAmount + ' telah masuk ke Saldo Tabungan Anda. Total saldo: ' + formattedBalance;
  } else if (typeUpper === 'SETOR_SAMPAH' || typeUpper === 'SETOR_PLASTIK' || typeUpper === 'SETOR_JELANTAH') {
    title = 'Setor Sampah Berhasil 🌱';
    const detailText = details ? ' (' + details + ')' : '';
    body = 'Setor sampah' + detailText + ' senilai ' + formattedAmount + ' telah ditambahkan ke Saldo Hijau Anda. Total saldo: ' + formattedBalance;
  } else if (typeUpper === 'TARIK_TUNAI') {
    title = 'Penarikan Tunai Berhasil 🏧';
    body = 'Penarikan sebesar ' + formattedAmount + ' berhasil. Sisa saldo Tabungan Anda: ' + formattedBalance;
  }

  const payload = {
    type: 'TRANSACTION',
    action: typeUpper,
    txId: String(txId || ''),
    memberId: String(memberId),
    amount: String(amount),
    newBalance: String(newBalance)
  };

  return sendFcmTopicMessage(
    topic,
    title,
    body,
    payload,
    CONFIG.FIREBASE && CONFIG.FIREBASE.CHANNELS ? CONFIG.FIREBASE.CHANNELS.TRANSAKSI : 'satus_transaksi_channel'
  );
}

/**
 * Notifikasi Permintaan Pembatalan (Void) dari Kasir ke Seluruh Manager
 */
function sendVoidRequestNotification(voidId, txId, reason, cashierId, memberId) {
  const topic = 'role_manager';
  const title = 'Pengajuan Void Transaksi ⚠️';
  const body = 'Kasir ' + (cashierId || 'Kasir') + ' mengajukan pembatalan transaksi ' + txId + '. Alasan: ' + reason;

  const payload = {
    type: 'VOID_REQUEST',
    voidId: String(voidId || ''),
    txId: String(txId || ''),
    cashierId: String(cashierId || ''),
    memberId: String(memberId || '')
  };

  return sendFcmTopicMessage(
    topic,
    title,
    body,
    payload,
    CONFIG.FIREBASE && CONFIG.FIREBASE.CHANNELS ? CONFIG.FIREBASE.CHANNELS.APPROVAL : 'satus_approval_channel'
  );
}

/**
 * Notifikasi Hasil Review Pembatalan (Void) dari Manager ke Kasir & Siswa
 */
function sendVoidReviewNotification(voidId, txId, cashierId, memberId, isApproved, rejectReason) {
  const status = isApproved ? 'APPROVED' : 'REJECTED';
  const title = isApproved ? 'Pembatalan Transaksi Disetujui ✅' : 'Pembatalan Transaksi Ditolak ❌';
  const body = isApproved
    ? 'Transaksi ' + txId + ' telah resmi dibatalkan dan saldo telah dipulihkan.'
    : 'Pengajuan pembatalan ' + txId + ' ditolak oleh Manager. Alasan: ' + (rejectReason || '-');

  const payload = {
    type: 'VOID',
    action: status,
    voidId: String(voidId || ''),
    txId: String(txId || ''),
    status: status
  };

  const channel = CONFIG.FIREBASE && CONFIG.FIREBASE.CHANNELS ? CONFIG.FIREBASE.CHANNELS.APPROVAL : 'satus_approval_channel';

  // 1. Kirim ke Kasir yang mengajukan
  if (cashierId) {
    sendFcmTopicMessage('user_' + sanitizeFcmTopic(cashierId), title, body, payload, channel);
  }

  // 2. Kirim ke Siswa pemilik transaksi
  if (memberId) {
    sendFcmTopicMessage('user_' + sanitizeFcmTopic(memberId), title, body, payload, channel);
  }
}

/**
 * Notifikasi Status Pengajuan Bibit Pohon/Tanaman ke Siswa
 */
function sendSeedStatusNotification(memberId, seedName, status) {
  if (!memberId) return;

  const topic = 'user_' + sanitizeFcmTopic(memberId);
  const isApproved = status === 'APPROVED';
  const isFulfilled = status === 'FULFILLED';
  
  let title = 'Pembaruan Bibit Tanaman 🌱';
  let body = 'Status bibit ' + (seedName || '') + ' telah diperbarui.';

  if (isApproved) {
    title = 'Pengajuan Bibit Disetujui! 🌳';
    body = 'Selamat! Pengajuan bibit ' + seedName + ' telah disetujui. Silakan ambil di pihak sekolah.';
  } else if (isFulfilled) {
    title = 'Bibit Berhasil Diterima 🌿';
    body = 'Bibit ' + seedName + ' telah berhasil Anda terima. Rawat dengan baik untuk bumi kita!';
  } else if (status === 'REJECTED') {
    title = 'Pengajuan Bibit Ditolak ⚠️';
    body = 'Mohon maaf, pengajuan bibit ' + seedName + ' belum dapat disetujui saat ini.';
  }

  const payload = {
    type: 'SEED_APPROVAL',
    status: String(status || ''),
    memberId: String(memberId)
  };

  return sendFcmTopicMessage(
    topic,
    title,
    body,
    payload,
    CONFIG.FIREBASE && CONFIG.FIREBASE.CHANNELS ? CONFIG.FIREBASE.CHANNELS.APPROVAL : 'satus_approval_channel'
  );
}

/**
 * Kirim Pengumuman / Broadcast Global atau per Role
 */
function sendBroadcastNotification(title, body, role) {
  let topic = 'all_users';
  if (role) {
    const r = String(role).toLowerCase().trim();
    topic = 'role_' + r;
  }

  const payload = {
    type: 'BROADCAST',
    role: String(role || 'ALL')
  };

  return sendFcmTopicMessage(
    topic,
    title,
    body,
    payload,
    CONFIG.FIREBASE && CONFIG.FIREBASE.CHANNELS ? CONFIG.FIREBASE.CHANNELS.INFO : 'satus_info_channel'
  );
}

/**
 * Memeriksa status konfigurasi kredensial Firebase di Apps Script
 */
function getFirebaseConfigStatus() {
  try {
    const saDetails = getFcmServiceAccountDetails();
    const props = PropertiesService.getScriptProperties();
    const serverKey = props.getProperty('FIREBASE_SERVER_KEY');

    let mode = 'NONE';
    if (saDetails.valid) {
      mode = 'SERVICE_ACCOUNT';
    } else if (serverKey) {
      mode = 'SERVER_KEY_DEPRECATED';
    }

    let maskedEmail = '';
    if (saDetails.clientEmail) {
      const parts = saDetails.clientEmail.split('@');
      if (parts.length === 2) {
        maskedEmail = parts[0].substring(0, 6) + '...@' + parts[1];
      } else {
        maskedEmail = saDetails.clientEmail.substring(0, 10) + '...';
      }
    }

    return {
      success: true,
      isConfigured: saDetails.valid,
      mode: mode,
      projectId: saDetails.projectId,
      clientEmail: maskedEmail,
      isJsonSource: saDetails.isJsonSource || false,
      error: saDetails.valid ? null : saDetails.error,
      channels: CONFIG.FIREBASE ? CONFIG.FIREBASE.CHANNELS : {}
    };
  } catch (e) {
    return { success: false, isConfigured: false, mode: 'ERROR', error: e.message };
  }
}

/**
 * Menguji koneksi kredensial Firebase secara menyeluruh dan mengembalikan laporan diagnostik
 */
function testFirebaseConnection() {
  const saDetails = getFcmServiceAccountDetails();
  const report = {
    timestamp: new Date().toISOString(),
    isConfigured: saDetails.valid,
    isJsonSource: saDetails.isJsonSource || false,
    projectId: saDetails.projectId,
    clientEmail: saDetails.clientEmail ? (saDetails.clientEmail.substring(0, 8) + '...' + saDetails.clientEmail.slice(-15)) : '-',
    hasPrivateKey: !!(saDetails.privateKey && saDetails.privateKey.includes('PRIVATE KEY')),
    steps: []
  };

  // Step 1: Script Properties Check
  if (!saDetails.valid) {
    report.steps.push({
      step: 'Kredensial Script Properties',
      status: 'FAILED',
      message: saDetails.error
    });
    report.overallStatus = 'FAILED';
    report.summary = saDetails.error;
    return report;
  }

  report.steps.push({
    step: 'Kredensial Script Properties',
    status: 'SUCCESS',
    message: 'Kredensial Service Account valid (Project ID: ' + saDetails.projectId + ')'
  });

  // Step 2: OAuth2 Token Exchange Check
  const tokenRes = getFcmAccessToken(true); // Force refresh token
  if (!tokenRes.success) {
    report.steps.push({
      step: 'Pembuatan OAuth2 Access Token',
      status: 'FAILED',
      message: tokenRes.error
    });
    report.overallStatus = 'FAILED';
    report.summary = tokenRes.error;
    return report;
  }

  report.steps.push({
    step: 'Pembuatan OAuth2 Access Token',
    status: 'SUCCESS',
    message: 'OAuth2 Access Token berhasil diperoleh dari Google'
  });

  // Step 3: Test FCM API Access (Validate with dry-run / validate_only payload)
  try {
    const testPayload = {
      validate_only: true, // Google FCM v1 validate_only flag: validasi tanpa broadcast ke HP
      message: {
        topic: 'all_users',
        data: {
          test: 'diagnostic_check',
          timestamp: String(Date.now())
        }
      }
    };

    const response = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + tokenRes.projectId + '/messages:send', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + tokenRes.token
      },
      payload: JSON.stringify(testPayload),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const content = response.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      report.steps.push({
        step: 'Akses Google Cloud FCM v1 API',
        status: 'SUCCESS',
        message: 'Koneksi ke Firebase Cloud Messaging API v1 sukses! Siap mengirim notifikasi.'
      });
      report.overallStatus = 'READY';
      report.summary = 'Semua pengujian lolos! Kredensial Firebase terhubung dan siap mengirim notifikasi ke aplikasi.';
    } else {
      let errDetail = content;
      try {
        const j = JSON.parse(content);
        if (j.error && j.error.message) errDetail = j.error.message;
      } catch (_) {}

      report.steps.push({
        step: 'Akses Google Cloud FCM v1 API',
        status: 'FAILED',
        code: statusCode,
        message: 'Google Cloud FCM API menolak request (HTTP ' + statusCode + '): ' + errDetail
      });
      report.overallStatus = 'FAILED';
      report.summary = 'Google Cloud FCM API menolak (HTTP ' + statusCode + '): ' + errDetail;
    }
  } catch (e) {
    report.steps.push({
      step: 'Akses Google Cloud FCM v1 API',
      status: 'FAILED',
      message: 'Exception saat menghubungi Google FCM: ' + e.message
    });
    report.overallStatus = 'FAILED';
    report.summary = 'Gagal menghubungi Google FCM: ' + e.message;
  }

  return report;
}

/**
 * Mengirim notifikasi pengujian langsung dari Dashboard Manager
 */
function sendTestPushNotification(params) {
  params = params || {};
  const target = params.target || 'all_users';
  const customId = params.customId || '';
  const title = params.title || 'Tes Notifikasi SATUS 🔔';
  const body = params.body || 'Halo! Ini adalah pesan pengujian notifikasi SATUS Mobile.';
  const channelId = params.channelId || 'satus_transaksi_channel';
  const actionType = params.actionType || 'TEST';

  let topic = target;
  if (target === 'custom' && customId) {
    topic = 'user_' + sanitizeFcmTopic(customId);
  } else if (!topic.startsWith('role_') && !topic.startsWith('user_') && topic !== 'all_users') {
    if (topic.toUpperCase() === 'SISWA') topic = 'role_siswa';
    else if (topic.toUpperCase() === 'KASIR') topic = 'role_kasir';
    else if (topic.toUpperCase() === 'MANAGER') topic = 'role_manager';
    else topic = 'user_' + sanitizeFcmTopic(topic);
  }

  const payload = {
    type: actionType,
    action: 'TEST_NOTIFICATION',
    sender: 'MANAGER_DASHBOARD',
    timestamp: new Date().toISOString()
  };

  const status = getFirebaseConfigStatus();
  const result = sendFcmTopicMessage(topic, title, body, payload, channelId);

  let message = '';
  if (result.success) {
    message = 'Tes notifikasi berhasil dikirim ke topik "' + topic + '"!';
  } else {
    message = 'Gagal mengirim notifikasi via FCM: ' + (result.message || 'Periksa kredensial Firebase');
  }

  return {
    success: result.success,
    isConfigured: status.isConfigured,
    mode: status.mode,
    topic: topic,
    channelId: channelId,
    message: message,
    fcmResult: result
  };
}

/**
 * Fungsi khusus untuk memicu dialog otorisasi izin OAuth scope (UrlFetchApp) di Google Apps Script
 * Jalankan fungsi ini 1 KALI dari Google Apps Script Editor (pilih dari dropdown lalu klik Run/Jalankan ▶)
 */
function authorizeExternalRequests() {
  console.log('--- MEMULAI OTORISASI IZIN URLFETCHAPP ---');
  try {
    const res = UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
    console.log('✅ Izin UrlFetchApp berhasil diotorisasi! Status HTTP: ' + res.getResponseCode());
    console.log('Melanjutkan ke pengujian koneksi Firebase...');
    const result = testFirebaseConnection();
    console.log('Hasil Uji Koneksi Firebase:', JSON.stringify(result, null, 2));
    return result;
  } catch (e) {
    console.error('❌ Gagal otorisasi atau koneksi:', e);
    throw e;
  }
}


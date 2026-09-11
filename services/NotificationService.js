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
 * Mendapatkan OAuth2 Access Token untuk Firebase Cloud Messaging HTTP v1 API
 * Menggunakan CacheService untuk menyimpan token selama 55 menit.
 */
function getFcmAccessToken() {
  const cache = CacheService.getScriptCache();
  const cachedToken = cache.get('FCM_ACCESS_TOKEN');
  if (cachedToken) {
    return cachedToken;
  }

  const scriptProperties = PropertiesService.getScriptProperties();
  let saJson = scriptProperties.getProperty('FIREBASE_SERVICE_ACCOUNT');
  let clientEmail = scriptProperties.getProperty('FIREBASE_CLIENT_EMAIL');
  let privateKey = scriptProperties.getProperty('FIREBASE_PRIVATE_KEY');

  if (saJson) {
    try {
      const parsed = JSON.parse(saJson);
      clientEmail = parsed.client_email;
      privateKey = parsed.private_key;
    } catch (e) {
      console.warn('Gagal mem-parse FIREBASE_SERVICE_ACCOUNT JSON:', e);
    }
  }

  // Jika kredensial service account belum diisi di Script Properties
  if (!clientEmail || !privateKey) {
    return null;
  }

  try {
    // Perbaiki format baris baru pada private key jika disimpan sebagai string literal \n
    privateKey = privateKey.replace(/\\n/g, '\n');

    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: 'RS256',
      typ: 'JWT'
    };

    const claim = {
      iss: clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    };

    const encodedHeader = Utilities.base64EncodeWebSafe(JSON.stringify(header)).replace(/=+$/, '');
    const encodedClaim = Utilities.base64EncodeWebSafe(JSON.stringify(claim)).replace(/=+$/, '');
    const unsignedJwt = encodedHeader + '.' + encodedClaim;

    const signature = Utilities.computeRsaSha256Signature(unsignedJwt, privateKey);
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

    const resJson = JSON.parse(response.getContentText());
    if (resJson.access_token) {
      cache.put('FCM_ACCESS_TOKEN', resJson.access_token, 3300); // Simpan 55 menit
      return resJson.access_token;
    } else {
      console.warn('Gagal mendapatkan access token OAuth2 Firebase:', resJson);
      return null;
    }
  } catch (e) {
    console.error('Error saat membuat FCM OAuth2 JWT:', e);
    return null;
  }
}

/**
 * Mengirim pesan FCM ke Topic tertentu
 */
function sendFcmTopicMessage(topic, title, body, dataPayload, channelId) {
  if (!CONFIG.FIREBASE || !CONFIG.FIREBASE.ENABLED) {
    return { success: false, message: 'Firebase notifications are disabled' };
  }

  const cleanTopic = sanitizeFcmTopic(topic);
  if (!cleanTopic) {
    return { success: false, message: 'Invalid topic' };
  }

  const targetChannel = channelId || (CONFIG.FIREBASE.CHANNELS ? CONFIG.FIREBASE.CHANNELS.TRANSAKSI : 'satus_transaksi_channel');
  const projectId = (CONFIG.FIREBASE && CONFIG.FIREBASE.PROJECT_ID) ? CONFIG.FIREBASE.PROJECT_ID : 'satus-mobile-mhsm1';

  // Pastikan seluruh values di dataPayload bertipe String
  const stringData = {};
  if (dataPayload && typeof dataPayload === 'object') {
    Object.keys(dataPayload).forEach(function(key) {
      stringData[key] = String(dataPayload[key] !== undefined && dataPayload[key] !== null ? dataPayload[key] : '');
    });
  }
  stringData.channel_id = targetChannel;

  // 1. Coba kirim via FCM HTTP v1 (Rekomendasi Google Modern)
  const accessToken = getFcmAccessToken();
  if (accessToken) {
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
          Authorization: 'Bearer ' + accessToken
        },
        payload: JSON.stringify(v1Payload),
        muteHttpExceptions: true
      });

      const statusCode = response.getResponseCode();
      const content = response.getContentText();
      if (statusCode >= 200 && statusCode < 300) {
        return { success: true, response: JSON.parse(content) };
      } else {
        console.warn('FCM v1 Error (HTTP ' + statusCode + '):', content);
      }
    } catch (e) {
      console.warn('FCM v1 Call Exception:', e);
    }
  }

  // 2. Fallback: Coba kirim via FCM Legacy / Server Key jika tersedia
  const serverKey = PropertiesService.getScriptProperties().getProperty('FIREBASE_SERVER_KEY');
  if (serverKey) {
    try {
      const legacyPayload = {
        to: '/topics/' + cleanTopic,
        priority: 'high',
        notification: {
          title: title,
          body: body,
          android_channel_id: targetChannel,
          sound: 'default'
        },
        data: stringData
      };

      const response = UrlFetchApp.fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: 'key=' + serverKey
        },
        payload: JSON.stringify(legacyPayload),
        muteHttpExceptions: true
      });

      const statusCode = response.getResponseCode();
      return { success: statusCode === 200, response: response.getContentText() };
    } catch (e) {
      console.warn('FCM Legacy Call Exception:', e);
    }
  }

  return { success: false, message: 'No valid FCM credentials configured or notification dispatch skipped.' };
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
    const props = PropertiesService.getScriptProperties();
    const sa = props.getProperty('FIREBASE_SERVICE_ACCOUNT');
    const clientEmail = props.getProperty('FIREBASE_CLIENT_EMAIL');
    const privateKey = props.getProperty('FIREBASE_PRIVATE_KEY');
    const serverKey = props.getProperty('FIREBASE_SERVER_KEY');

    const hasServiceAccount = !!(sa || (clientEmail && privateKey));
    const hasServerKey = !!serverKey;

    let mode = 'NONE';
    if (hasServiceAccount) mode = 'SERVICE_ACCOUNT';
    else if (hasServerKey) mode = 'SERVER_KEY';

    return {
      success: true,
      isConfigured: hasServiceAccount || hasServerKey,
      mode: mode,
      projectId: (CONFIG.FIREBASE && CONFIG.FIREBASE.PROJECT_ID) ? CONFIG.FIREBASE.PROJECT_ID : 'satus-mobile-mhsm1',
      channels: CONFIG.FIREBASE ? CONFIG.FIREBASE.CHANNELS : {}
    };
  } catch (e) {
    return { success: false, isConfigured: false, mode: 'ERROR', error: e.message };
  }
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
  } else if (status.isConfigured) {
    message = 'Gagal mengirim notifikasi via FCM: ' + (result.message || 'Periksa log server');
  } else {
    message = 'Kredensial Firebase belum terkonfigurasi di Script Properties. Notifikasi dicoba kirim namun membutuhkan FIREBASE_SERVICE_ACCOUNT atau FIREBASE_SERVER_KEY di Settings Apps Script.';
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


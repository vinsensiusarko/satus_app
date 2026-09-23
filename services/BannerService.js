// services/BannerService.js
// Layanan Manajemen Banner Firestore via REST API v1 untuk SATUS Mobile & Web

/**
 * Upsert banner pembaruan aplikasi ke Firestore (Collection: banners, Doc ID: app_update_latest)
 * Menggunakan Google Cloud Firestore REST API v1 dengan otorisasi Google Service Account.
 * 
 * @param {Object} params
 * @param {string} params.version - Nomor versi aplikasi (contoh: 2.3.3)
 * @param {number|string} params.buildNumber - Nomor build (contoh: 12)
 * @param {string} params.releaseNotes - Catatan rilis untuk isi/deskripsi banner
 * @param {string} params.playStoreUrl - URL Google Play Store aplikasi
 * @param {boolean} params.isMandatory - Apakah pembaruan wajib diinstall
 * @param {string} params.deploymentType - 'RELEASE' atau 'PATCH'
 * @returns {Object} JSON result { success: boolean, message: string, docId?: string }
 */
function upsertAppUpdateBanner(params) {
  try {
    params = params || {};
    const version = String(params.version || params.latest_version || '2.0.0').trim();
    const buildNumber = parseInt(params.buildNumber || params.build_number || params.latest_build_number || 1, 10);
    const releaseNotes = String(params.releaseNotes || params.release_notes || 'Pembaruan versi terbaru aplikasi SATUS Mobile dengan peningkatan stabilitas dan fitur terbaru.').trim();
    const playStoreUrl = String(params.playStoreUrl || params.play_store_url || 'https://play.google.com/store/apps/details?id=id.vinsensiusarka.satus_mobile').trim();
    const isMandatory = params.isMandatory === true || params.is_mandatory === true || String(params.isMandatory || params.is_mandatory).toUpperCase() === 'TRUE';
    const deploymentType = String(params.deploymentType || params.deployment_type || params.action_type || 'RELEASE').toUpperCase();

    // 1. Dapatkan OAuth Access Token yang menyertakan scope Datastore / Firestore
    const authRes = getFcmAccessToken();
    if (!authRes.success || !authRes.token) {
      console.warn('Gagal mendapatkan token Service Account untuk Firestore:', authRes.error);
      return { 
        success: false, 
        message: 'Gagal otorisasi Google Cloud Firestore: ' + (authRes.error || 'Token OAuth2 tidak valid') 
      };
    }

    const projectId = authRes.projectId || ((CONFIG.FIREBASE && CONFIG.FIREBASE.PROJECT_ID) ? CONFIG.FIREBASE.PROJECT_ID : 'satus-mobile-mhsm1');
    const docId = 'app_update_latest';
    const firestoreUrl = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)/documents/banners/' + docId;

    const title = 'Pembaruan SATUS Mobile v' + version;
    let subtitle = '';
    if (isMandatory) {
      subtitle = 'Wajib Update ke versi ' + version + ' (Build ' + buildNumber + ')';
    } else if (deploymentType === 'PATCH') {
      subtitle = 'Pembaruan Kilat (Patch) v' + version + ' telah diterapkan';
    } else {
      subtitle = 'Versi ' + version + ' (Build ' + buildNumber + ') resmi dirilis di Play Store!';
    }

    // Format Dokumen Cloud Firestore REST API v1
    const bannerDoc = {
      fields: {
        id: { stringValue: docId },
        title: { stringValue: title },
        subtitle: { stringValue: subtitle },
        description: { stringValue: releaseNotes },
        category: { stringValue: 'PENGUMUMAN' },
        actionUrl: { stringValue: playStoreUrl },
        actionLabel: { stringValue: isMandatory ? 'Wajib Update' : (deploymentType === 'PATCH' ? 'Lihat Detail' : 'Update Sekarang') },
        authorId: { stringValue: 'CI-CD-SYSTEM' },
        authorName: { stringValue: 'SATUS Official' },
        authorRole: { stringValue: 'MANAGER' },
        isActive: { booleanValue: true },
        priority: { integerValue: '99' }, // Prioritas 99 memastikan banner update selalu terdepan di slider dashboard
        createdAt: { timestampValue: new Date().toISOString() }
      }
    };

    const response = UrlFetchApp.fetch(firestoreUrl, {
      method: 'patch',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + authRes.token
      },
      payload: JSON.stringify(bannerDoc),
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const content = response.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      console.log('✅ Banner pembaruan aplikasi v' + version + '+' + buildNumber + ' berhasil di-upsert ke Firestore (' + docId + ')');
      return {
        success: true,
        message: 'Banner pembaruan versi v' + version + ' berhasil diperbarui di Firestore!',
        docId: docId,
        version: version,
        buildNumber: buildNumber
      };
    } else {
      console.error('❌ Gagal upsert banner Firestore (HTTP ' + statusCode + '):', content);
      return {
        success: false,
        code: statusCode,
        message: 'Firestore REST API menolak (HTTP ' + statusCode + '): ' + content
      };
    }
  } catch (err) {
    console.error('Exception saat upsert banner Firestore:', err);
    return { 
      success: false, 
      message: 'Exception Firestore REST API: ' + err.message 
    };
  }
}

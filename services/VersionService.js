// services/VersionService.js

/**
 * Memastikan sheet App_Version tersedia di spreadsheet dan memiliki data awal
 */
function ensureAppVersionSheet() {
  const sheetName = CONFIG.SHEETS.APP_VERSION || 'App_Version';
  const ss = getSpreadsheet();
  let sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    const headers = DATABASE_SCHEMAS[sheetName] || [
      'config_key', 'latest_version', 'latest_build_number', 'min_required_version', 
      'min_required_build_number', 'is_required', 'update_title', 'release_notes', 
      'play_store_url', 'is_active', 'updated_at'
    ];
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#10B981').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  } else {
    ensureSheetHeaders(sheet, sheetName);
  }

  // Jika baris hanya header, tambahkan row konfigurasi awal
  if (sheet.getLastRow() <= 1) {
    const def = (CONFIG && CONFIG.APP_VERSION_DEFAULT) || {
      config_key: 'ANDROID',
      latest_version: '1.0.0',
      latest_build_number: 1,
      min_required_version: '1.0.0',
      min_required_build_number: 1,
      is_required: false,
      update_title: 'Pembaruan SATUS Mobile Tersedia',
      release_notes: 'Pembaruan stabilitas dan peningkatan performa sistem.',
      play_store_url: 'https://play.google.com/store/apps/details?id=com.satus.app',
      is_active: true
    };

    sheet.appendRow([
      def.config_key || 'ANDROID',
      def.latest_version || '1.0.0',
      def.latest_build_number || 1,
      def.min_required_version || '1.0.0',
      def.min_required_build_number || 1,
      def.is_required ? 'TRUE' : 'FALSE',
      def.update_title || 'Pembaruan SATUS Mobile Tersedia',
      def.release_notes || 'Pembaruan stabilitas dan peningkatan performa sistem.',
      def.play_store_url || 'https://play.google.com/store/apps/details?id=com.satus.app',
      def.is_active ? 'TRUE' : 'FALSE',
      new Date().toISOString()
    ]);
  }

  return sheet;
}

/**
 * Membaca konfigurasi versi mobile app untuk Flutter API maupun Control Panel
 * @param {Object} params - Parameter opsional (version, build_number, platform)
 * @returns {Object} JSON response
 */
function getAppVersionConfig(params) {
  try {
    params = params || {};
    const platform = String(params.platform || 'ANDROID').trim().toUpperCase();
    const cacheKey = 'app_version_config_' + platform.toLowerCase();

    let config = null;
    try {
      const cached = CacheService.getScriptCache().get(cacheKey);
      if (cached) {
        config = JSON.parse(cached);
      }
    } catch (e) {
      console.warn('Cache get error in getAppVersionConfig:', e);
    }

    if (!config) {
      ensureAppVersionSheet();
      const sheetData = getSheetData(CONFIG.SHEETS.APP_VERSION);
      const row = sheetData.find(r => String(r.config_key || '').toUpperCase() === platform) || sheetData[0];

      if (row) {
        config = {
          config_key: String(row.config_key || platform),
          latest_version: String(row.latest_version || '1.0.0').trim(),
          latest_build_number: parseInt(row.latest_build_number, 10) || 1,
          min_required_version: String(row.min_required_version || '1.0.0').trim(),
          min_required_build_number: parseInt(row.min_required_build_number, 10) || 1,
          is_required: String(row.is_required).toUpperCase() === 'TRUE' || row.is_required === true,
          update_title: String(row.update_title || 'Pembaruan SATUS Mobile Tersedia').trim(),
          release_notes: String(row.release_notes || '').trim(),
          play_store_url: String(row.play_store_url || 'https://play.google.com/store/apps/details?id=com.satus.app').trim(),
          is_active: String(row.is_active).toUpperCase() === 'TRUE' || row.is_active === true,
          updated_at: row.updated_at || new Date().toISOString()
        };
      } else {
        config = { ...(CONFIG.APP_VERSION_DEFAULT || {}) };
      }

      // Simpan ke CacheService selama 300 detik (5 menit)
      try {
        CacheService.getScriptCache().put(cacheKey, JSON.stringify(config), 300);
      } catch (e) {}
    }

    // Jika client menyertakan informasi versi saat ini, lakukan komparasi otomatis
    const clientVersion = String(params.version || '').trim();
    const clientBuild = parseInt(params.build_number || params.buildNumber, 10);

    let hasUpdate = false;
    let isMandatory = false;

    if (!isNaN(clientBuild) && clientBuild > 0) {
      if (config.latest_build_number > clientBuild) {
        hasUpdate = true;
      }
      if (clientBuild < config.min_required_build_number || (hasUpdate && config.is_required)) {
        isMandatory = true;
      }
    } else if (clientVersion) {
      if (compareVersions(config.latest_version, clientVersion) > 0) {
        hasUpdate = true;
      }
      if (compareVersions(clientVersion, config.min_required_version) < 0 || (hasUpdate && config.is_required)) {
        isMandatory = true;
      }
    }

    return {
      success: true,
      message: 'Konfigurasi versi aplikasi berhasil dimuat',
      data: {
        ...config,
        client_version: clientVersion || null,
        client_build_number: !isNaN(clientBuild) ? clientBuild : null,
        has_update: hasUpdate,
        is_required: isMandatory || config.is_required,
        update_type: isMandatory ? 'REQUIRED' : (hasUpdate ? 'FLEXIBLE' : 'NONE')
      }
    };
  } catch (err) {
    console.error('getAppVersionConfig error:', err);
    return {
      success: false,
      message: 'Gagal memuat konfigurasi versi: ' + err.message,
      data: CONFIG.APP_VERSION_DEFAULT || {}
    };
  }
}

/**
 * Memperbarui konfigurasi versi mobile app (Hanya untuk Manager)
 * @param {string} token - Session auth token
 * @param {Object} dataUpdate - Data baru untuk versi aplikasi
 */
function updateAppVersionConfig(token, dataUpdate) {
  try {
    const session = verifyToken(token);
    if (!session) {
      return { success: false, error_code: 'UNAUTHORIZED', message: 'Sesi login telah berakhir' };
    }

    if (session.role !== CONFIG.ROLES.MANAGER) {
      return { success: false, error_code: 'FORBIDDEN', message: 'Akses ditolak. Hanya Manager yang dapat mengatur versi aplikasi.' };
    }

    dataUpdate = dataUpdate || {};
    const platform = String(dataUpdate.platform || dataUpdate.config_key || 'ANDROID').trim().toUpperCase();
    const latestVersion = String(dataUpdate.latest_version || dataUpdate.version || '1.0.0').trim();
    const latestBuild = parseInt(dataUpdate.latest_build_number || dataUpdate.build_number || 1, 10);
    const minVersion = String(dataUpdate.min_required_version || dataUpdate.min_version || '1.0.0').trim();
    const minBuild = parseInt(dataUpdate.min_required_build_number || dataUpdate.min_build || 1, 10);
    const isRequired = dataUpdate.is_required === true || String(dataUpdate.is_required).toUpperCase() === 'TRUE';
    const updateTitle = String(dataUpdate.update_title || 'Pembaruan SATUS Mobile Tersedia').trim();
    const releaseNotes = String(dataUpdate.release_notes || '').trim();
    const playStoreUrl = String(dataUpdate.play_store_url || 'https://play.google.com/store/apps/details?id=com.satus.app').trim();
    const isActive = dataUpdate.is_active !== false && String(dataUpdate.is_active).toUpperCase() !== 'FALSE';
    const updatedAt = new Date().toISOString();

    ensureAppVersionSheet();
    const sheetName = CONFIG.SHEETS.APP_VERSION;
    const sheet = getSheet(sheetName);
    const values = sheet.getDataRange().getValues();
    const headers = values[0];

    const colConfigKey = headers.indexOf('config_key');
    const colLatestVer = headers.indexOf('latest_version');
    const colLatestBuild = headers.indexOf('latest_build_number');
    const colMinVer = headers.indexOf('min_required_version');
    const colMinBuild = headers.indexOf('min_required_build_number');
    const colIsRequired = headers.indexOf('is_required');
    const colTitle = headers.indexOf('update_title');
    const colNotes = headers.indexOf('release_notes');
    const colUrl = headers.indexOf('play_store_url');
    const colIsActive = headers.indexOf('is_active');
    const colUpdatedAt = headers.indexOf('updated_at');

    let targetRow = -1;
    for (let i = 1; i < values.length; i++) {
      if (String(values[i][colConfigKey] || '').toUpperCase() === platform) {
        targetRow = i + 1;
        break;
      }
    }

    const rowData = [
      platform,
      latestVersion,
      latestBuild,
      minVersion,
      minBuild,
      isRequired ? 'TRUE' : 'FALSE',
      updateTitle,
      releaseNotes,
      playStoreUrl,
      isActive ? 'TRUE' : 'FALSE',
      updatedAt
    ];

    if (targetRow > 1) {
      sheet.getRange(targetRow, 1, 1, rowData.length).setValues([rowData]);
    } else {
      sheet.appendRow(rowData);
    }

    // Invalidate Cache
    delete cachedSheetData[sheetName];
    try {
      CacheService.getScriptCache().remove('app_version_config_' + platform.toLowerCase());
    } catch (e) {}

    // Audit Log
    const logDesc = 'Update Konfigurasi Versi Mobile (' + platform + '): v' + latestVersion + '+' + latestBuild + ', Wajib: ' + isRequired;
    auditLog(session.userId, session.role, 'UPDATE_APP_VERSION', platform, logDesc);

    const updatedConfig = {
      config_key: platform,
      latest_version: latestVersion,
      latest_build_number: latestBuild,
      min_required_version: minVersion,
      min_required_build_number: minBuild,
      is_required: isRequired,
      update_title: updateTitle,
      release_notes: releaseNotes,
      play_store_url: playStoreUrl,
      is_active: isActive,
      updated_at: updatedAt
    };

    return {
      success: true,
      message: 'Konfigurasi versi SATUS Mobile berhasil diperbarui!',
      data: updatedConfig
    };
  } catch (err) {
    console.error('updateAppVersionConfig error:', err);
    return { success: false, error_code: 'SERVER_ERROR', message: err.message };
  }
}

/**
 * Helper komparasi dua semver string (misal '1.0.1' vs '1.0.0')
 * Returns: 1 if a > b, -1 if a < b, 0 if equal
 */
function compareVersions(a, b) {
  const pa = String(a || '0').split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b || '0').split('.').map(n => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

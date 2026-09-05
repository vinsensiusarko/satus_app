// api/ApiRouter.gs

/**
 * ============================================================
 * SATUS Mobile API Router
 * Dispatches HTTP requests from Mobile App (Flutter)
 * ============================================================
 */

/**
 * Parses parameters from GET (query params) or POST (JSON body or form data)
 */
function parseApiParams(e) {
  const params = {};

  // 1. URL Query parameters (e.parameter)
  if (e && e.parameter) {
    for (const key in e.parameter) {
      params[key] = e.parameter[key];
    }
  }

  // 2. JSON Body from HTTP POST (e.postData.contents)
  if (e && e.postData && e.postData.contents) {
    try {
      const jsonBody = JSON.parse(e.postData.contents);
      if (typeof jsonBody === 'object' && jsonBody !== null) {
        for (const k in jsonBody) {
          params[k] = jsonBody[k];
        }
      }
    } catch (err) {
      // Body is not JSON, might already be parsed into e.parameter
    }
  }

  return params;
}

/**
 * Main API Request Dispatcher
 * @param {Object} e Event object from doGet or doPost
 * @param {string} method 'GET' or 'POST'
 * @returns {TextOutput} JSON response
 */
function handleApiRequest(e, method) {
  try {
    const params = parseApiParams(e);
    const action = String(params.action || params.endpoint || 'ping').trim().toLowerCase();

    let result = null;

    switch (action) {
      // 1. HEALTH CHECK / PING
      case 'ping':
      case 'health':
        result = {
          success: true,
          message: 'SATUS Mobile API is online',
          data: {
            app: 'SATUS - Kantong Hijau',
            institution: 'SMP Muhammadiyah 1 Magetan',
            version: '1.0.0',
            availableRoles: [CONFIG.ROLES.MANAGER, CONFIG.ROLES.KASIR, CONFIG.ROLES.SISWA],
            method: method,
            serverTime: new Date().toISOString()
          }
        };
        break;

      // 2. UNIFIED ROLE LOGIN (role is optional or validated)
      case 'login':
        result = apiLogin(params);
        break;

      // 3. ROLE-SPECIFIC LOGIN ENDPOINTS
      case 'login_manager':
      case 'login-manager':
      case 'manager_login':
        result = apiLoginRole(params, CONFIG.ROLES.MANAGER);
        break;

      case 'login_kasir':
      case 'login-kasir':
      case 'kasir_login':
        result = apiLoginRole(params, CONFIG.ROLES.KASIR);
        break;

      case 'login_siswa':
      case 'login-siswa':
      case 'siswa_login':
        result = apiLoginRole(params, CONFIG.ROLES.SISWA);
        break;

      // 4. TOKEN & SESSION VERIFICATION
      case 'verify_token':
      case 'verify-token':
      case 'check_token':
      case 'check_session':
        result = apiVerifyToken(params);
        break;

      // 5. GET USER PROFILE
      case 'profile':
      case 'me':
      case 'get_profile':
        result = apiGetProfile(params);
        break;

      // 6. CHANGE PASSWORD
      case 'change_password':
      case 'change-password':
        result = apiChangePassword(params);
        break;

      // 7. LOGOUT
      case 'logout':
        result = apiLogout(params);
        break;

      // 8. UNKNOWN ENDPOINT
      default:
        result = {
          success: false,
          error_code: 'UNKNOWN_ACTION',
          message: `Endpoint action '${action}' tidak dikenali. Daftar endpoint yang tersedia: ping, login, login_manager, login_kasir, login_siswa, verify_token, profile, change_password, logout.`
        };
        break;
    }

    return createJsonResponse(result);
  } catch (error) {
    console.error('API Router Error:', error);
    return createJsonResponse({
      success: false,
      error_code: 'INTERNAL_ERROR',
      message: error.message || 'Internal API Router Error'
    });
  }
}

/**
 * Formats JSON response and adds meta info
 */
function createJsonResponse(obj) {
  const output = Object.assign({
    meta: {
      timestamp: new Date().toISOString(),
      apiVersion: '1.0.0',
      system: 'SATUS Mobile API'
    }
  }, obj);

  return ContentService.createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

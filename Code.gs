// ============================================
// KONFIGURASI UTAMA
// ============================================
const SS = SpreadsheetApp.getActiveSpreadsheet();

function getSheet(name) {
  let sheet = SS.getSheetByName(name);
  if (!sheet) {
    sheet = SS.insertSheet(name);
    if (name === "tokens") sheet.appendRow(["qr_token", "course_id", "session_id", "expires_at", "ts"]);
    if (name === "presence") sheet.appendRow(["presence_id", "user_id", "device_id", "course_id", "session_id", "qr_token", "ts"]);
    if (name === "accel") sheet.appendRow(["device_id", "t", "x", "y", "z", "ts_server"]);
    if (name === "gps") sheet.appendRow(["timestamp", "device_id", "lat", "lng", "accuracy_m"]);
  }
  return sheet;
}

// ============================================
// CORE ROUTING (UNIVERSAL CATCH-ALL)
// ============================================
// Fungsi sakti untuk mendeteksi path dari berbagai tipe/style request milik kelompok siapapun
function getPath(e) {
  let rawPath = "";
  if (e.pathInfo) {
    rawPath = e.pathInfo;
  } else if (e.parameter) {
    if (e.parameter.endpoint) rawPath = e.parameter.endpoint;
    else if (e.parameter.path) rawPath = e.parameter.path;
    else if (e.parameter.action) rawPath = e.parameter.action;
    else if (e.parameter.mode) rawPath = e.parameter.mode;
  }
  return rawPath.replace(/^\/|\/$/g, '');
}

// Fungsi pembantu untuk memetakan penamaan aneh dari client kelompok lain 
// ke Standar API Contract kita
function normalizePayload(payload) {
  if (payload.nim && !payload.user_id) payload.user_id = payload.nim;
  if (payload.npm && !payload.user_id) payload.user_id = payload.npm;
  if (payload.token && !payload.qr_token) payload.qr_token = payload.token;
  if (payload.id && !payload.qr_token) payload.qr_token = payload.id;
  if (payload.makul && !payload.course_id) payload.course_id = payload.makul;
  if (payload.sesi && !payload.session_id) payload.session_id = payload.sesi;
  
  // Antisipasi jika object dikirim sebagai stringified Form Data
  if (typeof payload.samples === 'string') {
    try { payload.samples = JSON.parse(payload.samples); } catch(e){}
  }
  return payload;
}

function doGet(e) {
  const path = getPath(e);
  let params = e.parameter || {};
  params = normalizePayload(params); // alias mapping
  
  try {
    switch (path) {
      case 'presence/status': return handleGetPresenceStatus(params);
      case 'presence/list': return handleGetPresenceList(params);
      case 'telemetry/accel/latest': return handleGetAccelLatest(params);
      case 'telemetry/accel/all': return handleGetAccelAll(params);
      case 'telemetry/gps/latest': return handleGetGpsLatest(params);
      case 'telemetry/gps/history': return handleGetGpsHistory(params);
      case 'telemetry/gps/all': return handleGetGpsAll(params);
      default: return responseError(`unknown_endpoint: ${path || 'TIDAK_ADA'}`);
    }
  } catch (err) { 
    return responseError(err.toString()); 
  }
}

function doPost(e) {
  const path = getPath(e);
  let payload = {};
  
  // 1. Ambil dari GET parameters atau Form URL-Encoded (Fallback untuk Client non-REST)
  if (e.parameter) {
    Object.assign(payload, e.parameter);
  }

  // 2. Ambil dari Body Raw JSON (Prioritas Utama untuk Client Modern)
  if (e.postData && e.postData.contents) {
    try { 
      const jsonPayload = JSON.parse(e.postData.contents); 
      Object.assign(payload, jsonPayload); // akan me-replace isian query jika kembar
    } catch (err) { 
      // Jika error JSON.parse, abaikan karena mungkin murni berupa data Form Submission
    }
  }

  payload = normalizePayload(payload); // alias mapping

  try {
    switch (path) {
      case 'presence/qr/generate': return handlePostPresenceGenerate(payload);
      case 'presence/checkin': return handlePostPresenceCheckin(payload);
      case 'telemetry/accel': return handlePostTelemetryAccel(payload);
      case 'telemetry/gps': return handlePostTelemetryGps(payload);
      default: return responseError(`unknown_endpoint: ${path || 'TIDAK_ADA'}`);
    }
  } catch (err) { 
    return responseError(err.toString()); 
  }
}

// ============================================
// MODUL 1: PRESENSI QR DINAMIS
// ============================================
function handlePostPresenceGenerate(payload) {
  const { course_id, session_id, ts } = payload;
  if (!course_id || !session_id) return responseError("missing_field: course_id/session_id");

  const sheet = getSheet("tokens");
  const qr_token = "TKN-" + Math.random().toString(36).substring(2, 8).toUpperCase();
  const expiresAt = new Date(new Date(ts || Date.now()).getTime() + 2 * 60000).toISOString(); 
  
  sheet.appendRow([qr_token, course_id, session_id, expiresAt, ts || new Date().toISOString()]);
  
  return responseSuccess({ qr_token, expires_at: expiresAt });
}

function handlePostPresenceCheckin(payload) {
  // Destructuring aman dengan nilai default
  const { 
    user_id, 
    qr_token, 
    device_id = "unknown_device", 
    course_id = "", 
    session_id = "", 
    ts = new Date().toISOString() 
  } = payload;

  if (!user_id) return responseError("missing_field: user_id");
  if (!qr_token) return responseError("missing_field: qr_token");

  const tokenSheet = getSheet("tokens");
  const presenceSheet = getSheet("presence");
  
  const tokenData = tokenSheet.getDataRange().getValues();
  let foundToken = null;
  
  for(let i = 1; i < tokenData.length; i++) {
    if(tokenData[i][0] === qr_token) { 
      foundToken = {
        course: tokenData[i][1],
        session: tokenData[i][2],
        expiry: tokenData[i][3]
      }; 
      break; 
    }
  }

  if (!foundToken) return responseError("token_invalid");
  
  // Validasi Expiry
  const expiryDate = new Date(foundToken.expiry);
  const checkinDate = new Date(ts);
  if (checkinDate > expiryDate) return responseError("token_expired");

  const c_id = course_id || foundToken.course;
  const s_id = session_id || foundToken.session;

  const presence_id = "PR-" + Utilities.getUuid().substring(0,8);
  presenceSheet.appendRow([presence_id, user_id, device_id, c_id, s_id, qr_token, ts]);
  
  return responseSuccess({ presence_id, status: "checked_in" });
}

function handleGetPresenceStatus(params) {
  const { user_id, course_id, session_id } = params;
  if (!user_id) return responseError("missing_field: user_id");

  const sheet = getSheet("presence");
  const data = sheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][1] == user_id && data[i][3] == course_id && data[i][4] == session_id) {
      return responseSuccess({ 
        user_id: data[i][1], 
        course_id: data[i][3],
        session_id: data[i][4],
        status: "checked_in", 
        last_ts: data[i][6] 
      });
    }
  }
  return responseError("not_found");
}

function handleGetPresenceList(params) {
  const { course_id, session_id } = params;
  const sheet = getSheet("presence");
  const data = sheet.getDataRange().getValues();
  let items = [];

  for (let i = 1; i < data.length; i++) {
    if (data[i][3] == course_id && data[i][4] == session_id) {
      items.push({
        user_id: data[i][1],
        ts: data[i][6],
        status: "checked_in"
      });
    }
  }
  return responseSuccess({ items });
}

// ============================================
// MODUL 2: TELEMETRI ACCELEROMETER
// ============================================
function handlePostTelemetryAccel(payload) {
  const { device_id, samples } = payload;
  if (!device_id || !samples || !Array.isArray(samples)) return responseError("missing_field: device_id/samples");

  const sheet = getSheet("accel");
  const ts_server = new Date().toISOString();
  
  const rows = samples.map(s => [device_id, s.t, s.x, s.y, s.z, ts_server]);
  if (rows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  }
  return responseSuccess({ accepted: rows.length });
}

function handleGetAccelLatest(params) {
  const { device_id } = params;
  const sheet = getSheet("accel");
  const data = sheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][0] == device_id) {
      return responseSuccess({ t: data[i][1], x: data[i][2], y: data[i][3], z: data[i][4] });
    }
  }
  return responseError("not_found");
}

function handleGetAccelAll(params) {
  const sheet = getSheet("accel");
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const limit = 2 * 60 * 1000; // 2 Menit
  let devices = {};

  for (let i = 1; i < data.length; i++) {
    const device = data[i][0];
    const ts = new Date(data[i][5]); // Gunakan ts_server 
    if (now - ts > limit) continue;

    devices[device] = {
      device_id: device,
      ts: data[i][1],
      x: data[i][2],
      y: data[i][3],
      z: data[i][4]
    };
  }
  return responseSuccess({ items: Object.values(devices) });
}

// ============================================
// MODUL 3: TELEMETRI GPS
// ============================================
function handlePostTelemetryGps(payload) {
  const { device_id, ts, lat, lng, accuracy_m } = payload;
  if(!device_id) return responseError("missing_field: device_id");
  const sheet = getSheet("gps");
  sheet.appendRow([ts || new Date().toISOString(), device_id, lat, lng, accuracy_m || 0]);
  return responseSuccess({ accepted: true });
}

function handleGetGpsLatest(params) {
  const { device_id } = params;
  const sheet = getSheet("gps");
  const data = sheet.getDataRange().getValues();

  for (let i = data.length - 1; i >= 1; i--) {
    if (data[i][1] == device_id) {
      return responseSuccess({ ts: data[i][0], lat: data[i][2], lng: data[i][3], accuracy_m: data[i][4] });
    }
  }
  return responseError("not_found");
}

function handleGetGpsHistory(params) {
  const { device_id } = params;
  const sheet = getSheet("gps");
  const data = sheet.getDataRange().getValues();
  const items = [];
  
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] == device_id) {
      items.push({ ts: data[i][0], lat: data[i][2], lng: data[i][3] });
    }
  }
  return responseSuccess({ device_id, items });
}

function handleGetGpsAll(params) {
  const sheet = getSheet("gps");
  const data = sheet.getDataRange().getValues();
  const now = new Date();
  const limit = 2 * 60 * 1000; 
  let devices = {};

  for (let i = 1; i < data.length; i++) {
    const device = data[i][1];
    const ts = new Date(data[i][0]);
    if (now - ts > limit) continue;

    devices[device] = {
      device_id: device,
      ts: data[i][0],
      lat: data[i][2],
      lng: data[i][3],
      accuracy_m: data[i][4]
    };
  }
  return responseSuccess({ items: Object.values(devices) });
}

// ============================================
// JSON HELPERS
// ============================================
function responseSuccess(data) {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, data }))
    .setMimeType(ContentService.MimeType.JSON);
}

function responseError(msg) {
  return ContentService.createTextOutput(JSON.stringify({ ok: false, error: msg }))
    .setMimeType(ContentService.MimeType.JSON);
}
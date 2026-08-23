/*
Finds-or-creates the Tracking spreadsheet, the only state kept outside Gmail.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

let _trackingSpreadsheetCache;
let _trackingSheetCache;

function getOrCreateTrackingSpreadsheet_() {
  if (_trackingSpreadsheetCache) return _trackingSpreadsheetCache;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROPS.TRACKING_SHEET_ID);
  const name = trackingSpreadsheetName_();
  let ss;

  // 1. Stored ID path. Best-effort Drive trashed-check; falls back to plain open if Drive isn't authorized.
  if (id) {
    let trashed = false;
    try { trashed = DriveApp.getFileById(id).isTrashed(); }
    catch (e) { console.log('Drive trashed-check skipped: ' + e.toString()); }
    if (!trashed) {
      try { ss = SpreadsheetApp.openById(id); }
      catch (e) { console.log('Stored sheet not openable: ' + e.toString()); }
    } else {
      console.log('Stored sheet is in trash; falling through.');
    }
  }

  // 2. Drive search fallback. Recovers if Script Properties was wiped but a sheet of the right name exists.
  if (!ss) {
    try {
      const files = DriveApp.getFilesByName(name);
      while (files.hasNext()) {
        const f = files.next();
        if (f.isTrashed()) continue;
        ss = SpreadsheetApp.openById(f.getId());
        props.setProperty(PROPS.TRACKING_SHEET_ID, f.getId());
        Logger.log('Recovered existing sheet via Drive search: ' + ss.getUrl());
        break;
      }
    } catch (e) { console.log('Drive search skipped: ' + e.toString()); }
  }

  // 3. Create fresh, last resort. Drop the default tab so Tracking is the only one.
  if (!ss) {
    ss = SpreadsheetApp.create(name);
    props.setProperty(PROPS.TRACKING_SHEET_ID, ss.getId());
    ensureSheet_(ss, SHEET_TAB_TRACKING, TRACKING_HEADERS);
    ss.getSheets().forEach(s => { if (s.getName() !== SHEET_TAB_TRACKING) ss.deleteSheet(s); });
    Logger.log('Created tracking sheet: ' + ss.getUrl());
  }
  if (ss.getName() !== name) ss.rename(name);
  ensureSheet_(ss, SHEET_TAB_TRACKING, TRACKING_HEADERS);
  _trackingSpreadsheetCache = ss;
  return ss;
}

function trackingSpreadsheetName_() {
  // Session.getEffectiveUser().getEmail() returns empty under Google's privacy defaults.
  // Gmail.Users.getProfile is already authorized via the Gmail Advanced Service.
  try {
    const email = Gmail.Users.getProfile('me').emailAddress;
    return email ? TRACKING_SPREADSHEET_NAME + ' (' + email + ')' : TRACKING_SPREADSHEET_NAME;
  } catch (e) {
    return TRACKING_SPREADSHEET_NAME;
  }
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getTrackingSheet_() {
  if (!_trackingSheetCache) {
    _trackingSheetCache = getOrCreateTrackingSpreadsheet_().getSheetByName(SHEET_TAB_TRACKING);
  }
  return _trackingSheetCache;
}

function validate() {
  const ss = getOrCreateTrackingSpreadsheet_();
  const sheet = ss.getSheetByName(SHEET_TAB_TRACKING);
  const lastCol = sheet.getLastColumn();
  const headers = lastCol === 0 ? [] : sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const ok = headers.length === TRACKING_HEADERS.length && headers.every((h, i) => h === TRACKING_HEADERS[i]);
  Logger.log(ok
    ? `✓ ${SHEET_TAB_TRACKING}: schema OK`
    : `⚠ ${SHEET_TAB_TRACKING}: headers are [${headers.join(', ')}], expected [${TRACKING_HEADERS.join(', ')}]`);

  // Surface legacy tabs (e.g. Observations/Scoreboard from the retired LLM classifier) so the
  // user can drop them manually. We don't auto-delete user data.
  const legacy = ss.getSheets().map(s => s.getName()).filter(n => n !== SHEET_TAB_TRACKING);
  if (legacy.length > 0) Logger.log('⚠ Legacy tabs present (safe to delete manually): ' + legacy.join(', '));
}

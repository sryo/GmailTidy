/*
Project bootstrap: install, diagnose, menu, labels, triggers.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function install() {
  Logger.log('--- GmailTidy install ---');
  const ss = getOrCreateTrackingSpreadsheet_();
  Logger.log(`Spreadsheet: ${ss.getUrl()}`);
  validate();
  checkEnvironment_();
  ensureLabels_();
  ensureTriggers_();
  ensureMenuTrigger_();
  Logger.log('--- install complete ---');
}

function diagnose() {
  Logger.log('--- GmailTidy diagnose ---');
  const ss = getOrCreateTrackingSpreadsheet_();
  Logger.log('Spreadsheet: ' + ss.getUrl());

  const tracking = getTrackingSheet_();
  const trackingRows = Math.max(0, tracking.getLastRow() - 1);
  Logger.log(`Rows: tracking=${trackingRows}`);

  if (trackingRows > 0) {
    const types = tracking.getRange(2, 2, trackingRows, 1).getValues();
    const byType = {};
    types.forEach(([t]) => { byType[t] = (byType[t] || 0) + 1; });
    Logger.log('Tracking by type: ' + JSON.stringify(byType));
  }

  checkEnvironment_();

  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('Triggers (' + triggers.length + '):');
  triggers.forEach(t => Logger.log('  - ' + t.getHandlerFunction() + ' (' + t.getTriggerSource() + ')'));

  Logger.log('--- diagnose complete ---');
}

function checkEnvironment_() {
  const apiKey = PropertiesService.getScriptProperties().getProperty(PROPS.GEMINI_API_KEY);
  Logger.log(apiKey
    ? `✓ GEMINI_API_KEY is set (length ${apiKey.length})`
    : `⚠ GEMINI_API_KEY not set. Project Settings → Script Properties → add it.`);
  try {
    Gmail.Users.getProfile('me');
    Logger.log('✓ Gmail Advanced Service is enabled');
  } catch (e) {
    Logger.log(`⚠ Gmail Advanced Service not enabled (${e.toString()}). Project Settings → Services → add Gmail API.`);
  }
}

function addMenu() {
  SpreadsheetApp.getUi()
    .createMenu('GmailTidy')
    .addItem('Diagnose', 'diagnose')
    .addItem('Run cleanUp now', TRIGGER_CLEANUP_HANDLER)
    .addItem('Run cleanUpDeep now', TRIGGER_CLEANUP_DEEP_HANDLER)
    .addSeparator()
    .addItem('Re-run install', 'install')
    .addToUi();
}

function ensureMenuTrigger_() {
  const ssId = getOrCreateTrackingSpreadsheet_().getId();
  const exists = ScriptApp.getProjectTriggers().some(t =>
    t.getHandlerFunction() === MENU_HANDLER && t.getTriggerSourceId() === ssId
  );
  if (exists) {
    Logger.log('✓ menu trigger already exists');
    return;
  }
  ScriptApp.newTrigger(MENU_HANDLER).forSpreadsheet(ssId).onOpen().create();
  Logger.log('+ menu trigger installed');
}

function ensureLabels_() {
  PROTECTED_LABELS.forEach(name => getOrCreateUserLabel(name));
  Logger.log('✓ labels available: ' + PROTECTED_LABELS.join(' '));
}

// Always delete + recreate. Apps Script doesn't expose existing-trigger
// intervals, so this is the only way interval changes (TRIGGER_*_MIN) and
// handler renames propagate. Menu trigger is preserved.
function ensureTriggers_() {
  const wanted = [
    { fn: TRIGGER_CLEANUP_HANDLER,              kind: 'minutes',     value: TRIGGER_CLEANUP_MIN },
    { fn: TRIGGER_CLEANUP_DEEP_HANDLER,         kind: 'minutes',     value: TRIGGER_CLEANUP_DEEP_MIN },
    { fn: TRIGGER_BUNCH_HANDLER,                kind: 'minutes',     value: TRIGGER_BUNCH_MIN },
    { fn: TRIGGER_REMOVE_EMPTY_LABELS_HANDLER,  kind: 'minutes',     value: TRIGGER_REMOVE_EMPTY_LABELS_MIN },
    { fn: TRIGGER_BURNDOWN_HANDLER,             kind: 'dailyAtHour', value: BURNDOWN_HOUR },
    { fn: TRIGGER_DAILY_MAINTENANCE_HANDLER,    kind: 'dailyAtHour', value: TRIGGER_DAILY_MAINTENANCE_HOUR }
  ];
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === MENU_HANDLER) return;
    ScriptApp.deleteTrigger(t);
  });
  wanted.forEach(w => {
    if (w.kind === 'minutes') {
      ScriptApp.newTrigger(w.fn).timeBased().everyMinutes(w.value).create();
      Logger.log(`+ trigger ${w.fn} (every ${w.value} min)`);
    } else if (w.kind === 'dailyAtHour') {
      ScriptApp.newTrigger(w.fn).timeBased().atHour(w.value).everyDays(1).create();
      Logger.log(`+ trigger ${w.fn} (daily at hour ${w.value})`);
    }
  });
}

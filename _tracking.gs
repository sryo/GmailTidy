/*
Tracking tab: thin store of orthogonal per-thread markers used by ping, riff, and burndown.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

let _trackingValuesCache = null;

function getTrackingValues_() {
  if (_trackingValuesCache === null) {
    _trackingValuesCache = getTrackingSheet_().getDataRange().getValues();
  }
  return _trackingValuesCache;
}

function invalidateTrackingValuesCache_() {
  _trackingValuesCache = null;
}

function recordTrackingRows(threadIds, type) {
  if (!threadIds || threadIds.length === 0) return;
  const now = new Date().toISOString();
  appendRowsBatch(getTrackingSheet_(), threadIds.map(id => [id, type, now]));
  invalidateTrackingValuesCache_();
}

function deleteTrackingRows_(rowNumbers) {
  if (!rowNumbers || rowNumbers.length === 0) return;
  deleteRowsReverse(getTrackingSheet_(), rowNumbers);
  invalidateTrackingValuesCache_();
}

// {threadId: rowNumber} for a single type. Used by ping/riff to dedup + detect dismissal/discard.
function trackingIndex_(type) {
  const data = getTrackingValues_();
  const idx = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === type && !idx[data[i][0]]) idx[data[i][0]] = i + 1;
  }
  return idx;
}

// {threadId: epochMs} for a single type, from the row's timestamp.
function trackingTimes_(type) {
  const data = getTrackingValues_();
  const out = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === type && !out[data[i][0]]) out[data[i][0]] = Date.parse(data[i][2]);
  }
  return out;
}

// Drops tracking rows past their per-type TTL (TRACKING_TTL_DAYS_BY_TYPE).
function pruneTracking_() {
  const data = getTrackingValues_();
  if (data.length < 2) return;
  const now = Date.now();
  const rowsToDelete = [];
  for (let i = 1; i < data.length; i++) {
    const [, type, ts] = data[i];
    const ttl = TRACKING_TTL_DAYS_BY_TYPE[type];
    if (!ttl) continue;
    const t = Date.parse(ts);
    if (isNaN(t) || t < now - ttl * MS_PER_DAY) rowsToDelete.push(i + 1);
  }
  if (rowsToDelete.length > 0) {
    deleteTrackingRows_(rowsToDelete);
    console.log('🧹 Pruned ' + rowsToDelete.length + ' tracking rows');
  }
}

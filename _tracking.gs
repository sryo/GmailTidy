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

// Drops tracking rows past their per-type TTL. Drafted is state-managed by riff (deleted on send
// or discard), so it has no TTL here. Pinged is dead weight once a thread crosses PING_EXPIRE_DAYS
// (ping query stops matching it), with slack for late dismissals. Burndown is the digest dedup
// window.
const TRACKING_TTL_DAYS_BY_TYPE = {
  [TRACKING_TYPE_PINGED]: PING_EXPIRE_DAYS,
  [TRACKING_TYPE_BURNDOWN_PROCESSED]: BURNDOWN_PROCESSED_TTL_DAYS,
};

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
    if (isNaN(t) || t < now - ttl * 24 * 3600 * 1000) rowsToDelete.push(i + 1);
  }
  if (rowsToDelete.length > 0) {
    deleteTrackingRows_(rowsToDelete);
    Logger.log('🧹 Pruned ' + rowsToDelete.length + ' tracking rows.');
  }
}

/*
Deep pass: features that need more time or external calls than cleanUp can afford.
Author: Mateo Yadarola (teodalton@gmail.com)
*/

function cleanUpDeep() {
  safely_('riff',                    riff);
  safely_('processBurndownReplies_', processBurndownReplies_);
}

// Retention runs once a day. Wired in ensureTriggers_.
function dailyMaintenance() {
  safely_('pruneTracking_', pruneTracking_);
}

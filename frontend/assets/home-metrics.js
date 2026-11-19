/* Laufende Myfxbook-Perioden: keine Durchschnittsraten, keine historischen Ersatzwerte. */
(function (root) {
  "use strict";
  var SOURCE = "https://www.myfxbook.com/members/SonicExperts/sonic-ai/12076857";
  var mapping = { daily: "today", weekly: "week", monthly: "month" };

  function rates(snapshot) {
    var result = { daily: null, weekly: null, monthly: null };
    if (!snapshot || snapshot.schema_version !== 1 || snapshot.account_name !== "SONIC AI" || snapshot.source !== SOURCE || !snapshot.periods || !isFinite(Date.parse(snapshot.fetched_utc))) return result;
    Object.keys(mapping).forEach(function (key) {
      var period = snapshot.periods[mapping[key]];
      if (!period || period.available !== true || typeof period.gain !== "string" || !/^[+-]?\d+(?:\.\d+)?%$/.test(period.gain)) return;
      var value = Number(period.gain.slice(0, -1)) / 100;
      if (isFinite(value)) result[key] = value;
    });
    return result;
  }

  function amplified(rate, amplify, netFraction) {
    if (rate == null || !isFinite(rate)) return null;
    var gross = rate * amplify;
    return gross > 0 ? gross * netFraction : gross;
  }

  function share(rate, amplify, commission) {
    if (rate == null || !isFinite(rate)) return null;
    // Ein Verlust ist kein negativer Bonus. Nichtverfügbarkeit bleibt davon getrennt.
    return Math.max(0, rate * amplify) * commission;
  }

  var api = { rates: rates, amplified: amplified, share: share };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HomeMetrics = api;
})(typeof window !== "undefined" ? window : globalThis);

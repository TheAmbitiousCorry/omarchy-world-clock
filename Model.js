// Pure time-zone math for the world clock widget and its popup. Nothing
// here touches Qt: offsets arrive as plain minute integers (from a shelled
// `TZ=<zone> date +%z`, since this engine's Date has no working timeZone
// support), and every date this file hands back is a JS Date built through
// the local constructor so the caller's own Qt.formatDateTime/Qt.formatDate
// read it correctly. Exported for node the way clock/Model.js does it, and
// covered by test/model.test.js.

var MS_PER_DAY = 86400000

// A conventional three-or-four-letter code for the handful of cities people
// actually add. Anything else falls through to the initials/first-three-
// letters rule in deriveLabel.
var KNOWN_CITY_LABELS = {
  "new york": "NYC",
  "london": "LON",
  "tokyo": "TYO",
  "cape town": "CPT",
  "los angeles": "LA",
  "san francisco": "SF",
  "paris": "PAR",
  "berlin": "BER",
  "sydney": "SYD",
  "singapore": "SIN",
  "dubai": "DXB",
  "hong kong": "HKG",
  "johannesburg": "JNB",
  "amsterdam": "AMS",
  "toronto": "TOR",
  "chicago": "CHI",
  "mumbai": "BOM",
  "sao paulo": "SAO",
  "madrid": "MAD",
  "rome": "ROM",
  "moscow": "MOW",
  "beijing": "BJS",
  "shanghai": "SHA",
  "seoul": "SEL",
  "bangkok": "BKK",
  "istanbul": "IST",
  "cairo": "CAI",
  "mexico city": "MEX",
  "buenos aires": "BUE",
  "vancouver": "YVR",
  "chennai": "MAA",
  "delhi": "DEL",
  "new delhi": "DEL",
  "kolkata": "CCU",
  "auckland": "AKL",
  "wellington": "WLG",
  "zurich": "ZRH",
  "vienna": "VIE",
  "stockholm": "STO",
  "oslo": "OSL",
  "copenhagen": "CPH",
  "dublin": "DUB",
  "lisbon": "LIS",
  "athens": "ATH",
  "warsaw": "WAW",
  "prague": "PRG",
  "budapest": "BUD"
}

// Explicit diacritic -> base-letter fold, used when the engine's
// String.prototype.normalize is missing. Covers the Latin-alphabet marks
// that actually show up in Open-Meteo city names (accents, umlauts,
// cedillas, strokes, rings); anything outside this table passes through
// unchanged, same as normalize()+combining-mark-strip would leave it.
var DIACRITIC_FOLD_MAP = {
  "À": "A", "Á": "A", "Â": "A", "Ã": "A", "Ä": "A", "Å": "A",
  "à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a",
  "Ç": "C", "ç": "c",
  "È": "E", "É": "E", "Ê": "E", "Ë": "E",
  "è": "e", "é": "e", "ê": "e", "ë": "e",
  "Ì": "I", "Í": "I", "Î": "I", "Ï": "I",
  "ì": "i", "í": "i", "î": "i", "ï": "i",
  "Ñ": "N", "ñ": "n",
  "Ò": "O", "Ó": "O", "Ô": "O", "Õ": "O", "Ö": "O", "Ø": "O",
  "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o", "ø": "o",
  "Ù": "U", "Ú": "U", "Û": "U", "Ü": "U",
  "ù": "u", "ú": "u", "û": "u", "ü": "u",
  "Ý": "Y", "ý": "y", "ÿ": "y",
  "Š": "S", "š": "s",
  "Ž": "Z", "ž": "z"
}

// Strips accents so "São Paulo" and "Zürich" match a plain-ASCII table key
// and produce a plain-ASCII fallback label. Prefers normalize()+combining-
// mark-strip (handles every precomposed Latin character, not just the ones
// in the fold map); falls back to the explicit table when normalize is
// unavailable, which this widget's QML JavaScript engine cannot be assumed
// to have (it has no Intl at all -- see the file banner).
function foldDiacritics(text) {
  var value = String(text || "")
  if (typeof value.normalize === "function") {
    return value.normalize("NFD").replace(/[̀-ͯ]/g, "")
  }
  var out = ""
  for (var i = 0; i < value.length; i++) {
    var ch = value.charAt(i)
    out += DIACRITIC_FOLD_MAP[ch] || ch
  }
  return out
}

// Known city first, otherwise initials of up to three words, otherwise the
// first three letters of a one-word name. Always uppercase. Diacritics are
// folded before both the table lookup and the fallback, so "São Paulo"
// finds the "sao paulo" table key and "Zürich" falls back to "ZUR" rather
// than "ZÜR".
function deriveLabel(name) {
  var trimmed = String(name || "").replace(/^\s+|\s+$/g, "")
  if (trimmed === "") return ""
  var folded = foldDiacritics(trimmed)
  var known = KNOWN_CITY_LABELS[folded.toLowerCase()]
  if (known) return known

  var words = folded.split(/\s+/).filter(function(w) { return w.length > 0 })
  if (words.length > 1) {
    return words.slice(0, 3).map(function(w) { return w.charAt(0) }).join("").toUpperCase()
  }
  return folded.substr(0, 3).toUpperCase()
}

// Loose IANA shape check (Area/Location, optionally several segments).
// Geocoding results and hand edits both pass through this before a zone is
// ever handed to `date`; the file-existence half of the check lives in the
// shell command that actually calls it, since node/QML have no
// zoneinfo-independent way to confirm a name resolves.
function isValidTimezoneFormat(tz) {
  return /^[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)*$/.test(String(tz || ""))
}

function defaultZones() {
  return [{ label: "NYC", name: "New York", country: "United States", timezone: "America/New_York" }]
}

// A saved zone tolerant of a hand edit: missing/blank name or an
// unparseable timezone drops the entry rather than crashing the widget. A
// present label is kept as-is (so a hand-written override sticks); a
// missing one is derived from the name.
function normalizeZone(raw) {
  if (!raw || typeof raw !== "object") return null
  var timezone = typeof raw.timezone === "string" ? raw.timezone.replace(/^\s+|\s+$/g, "") : ""
  if (!isValidTimezoneFormat(timezone)) return null
  var name = typeof raw.name === "string" ? raw.name.replace(/^\s+|\s+$/g, "") : ""
  if (name === "") return null
  var country = typeof raw.country === "string" ? raw.country.replace(/^\s+|\s+$/g, "") : ""
  var label = typeof raw.label === "string" && raw.label.replace(/^\s+|\s+$/g, "") !== ""
    ? raw.label.replace(/^\s+|\s+$/g, "").toUpperCase()
    : deriveLabel(name)
  return { label: label, name: name, country: country, timezone: timezone }
}

function normalizeZones(raw) {
  // Duck-typed rather than Array.isArray: the zones array QML hands in from
  // shell.json is a real array (constructor.name === "Array", indexable,
  // has .length) but comes from a different JS realm than this file's, and
  // Array.isArray returns false across that boundary on this engine.
  var list = raw && typeof raw.length === "number" ? raw : []
  var out = []
  for (var i = 0; i < list.length; i++) {
    var zone = normalizeZone(list[i])
    if (zone) out.push(zone)
  }
  return out
}

// The active zone: whatever is saved, as long as it still names a saved
// zone; the first zone otherwise (including "not set" and "zone since
// removed"). Empty string with zero zones.
function normalizeActive(zones, active) {
  if (typeof active === "string" && zones.some(function(z) { return z.timezone === active })) return active
  return zones.length > 0 ? zones[0].timezone : ""
}

// shell.json entry -> { zones, active, format }. A missing `zones` key
// (a fresh widget) gets the New York default; a present-but-malformed one
// is normalized down to whatever entries survive, including zero.
function normalizeSettings(settings) {
  var s = settings || {}
  var zones = (s.zones === undefined || s.zones === null) ? defaultZones() : normalizeZones(s.zones)
  var format = typeof s.format === "string" && s.format !== "" ? s.format : "HH:mm"
  return { zones: zones, active: normalizeActive(zones, s.active), format: format }
}

function activeIndex(zones, active) {
  for (var i = 0; i < zones.length; i++) if (zones[i].timezone === active) return i
  return zones.length > 0 ? 0 : -1
}

// Wraps in both directions; a direction of 0 or an empty list is a no-op.
function stepActive(zones, active, direction) {
  if (zones.length === 0) return active
  var index = activeIndex(zones, active)
  if (index === -1) index = 0
  var delta = direction < 0 ? -1 : 1
  return zones[(index + delta + zones.length) % zones.length].timezone
}

function findZoneIndex(zones, timezone, name) {
  for (var i = 0; i < zones.length; i++) {
    if (zones[i].timezone === timezone && zones[i].name === name) return i
  }
  return -1
}

// Appends a geocoded candidate, or activates the matching zone already
// saved under the same timezone and name rather than duplicating it.
function addZone(zones, active, candidate) {
  var normalized = normalizeZone(candidate)
  if (!normalized) return { zones: zones, active: active, added: false }

  var existing = findZoneIndex(zones, normalized.timezone, normalized.name)
  if (existing !== -1) return { zones: zones, active: zones[existing].timezone, added: false }

  return { zones: zones.concat([normalized]), active: normalized.timezone, added: true }
}

// Removes the zone at `index`. Removing the active zone activates its
// neighbour (the one that slides into its slot, or the new last entry when
// it was last); removing any other zone leaves the active zone alone.
function removeZoneAt(zones, active, index) {
  if (index < 0 || index >= zones.length) return { zones: zones, active: active }

  var removedTimezone = zones[index].timezone
  var nextZones = zones.slice(0, index).concat(zones.slice(index + 1))

  if (removedTimezone !== active) return { zones: nextZones, active: active }
  if (nextZones.length === 0) return { zones: nextZones, active: "" }

  var neighbourIndex = index < nextZones.length ? index : nextZones.length - 1
  return { zones: nextZones, active: nextZones[neighbourIndex].timezone }
}

// A zone's wall-clock reading as a Date built through the local
// constructor, so a caller's Qt.formatDateTime/getFullYear/getDate all read
// the zone's own year/month/day/hour/minute rather than the machine's.
// `offsetMinutes` null/undefined/non-finite (zone probe failed or hasn't
// run yet) yields null.
function zoneWallClockDate(nowMs, offsetMinutes) {
  if (offsetMinutes === null || offsetMinutes === undefined || !isFinite(offsetMinutes)) return null
  var shifted = new Date(nowMs + offsetMinutes * 60000)
  return new Date(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(),
    shifted.getUTCHours(), shifted.getUTCMinutes(), shifted.getUTCSeconds())
}

function pad2(value) {
  var n = Number(value)
  return (n < 10 ? "0" : "") + n
}

// Row offset from local: "0h", "-6h", "+5:30". Whole hours drop the
// minutes; a half/45-minute zone keeps them as h:mm.
function formatSignedOffset(diffMinutes) {
  if (!isFinite(diffMinutes)) return "--"
  var abs = Math.round(Math.abs(diffMinutes))
  if (abs === 0) return "0h"
  var hours = Math.floor(abs / 60)
  var minutes = abs % 60
  var sign = diffMinutes < 0 ? "-" : "+"
  return sign + hours + (minutes === 0 ? "h" : ":" + pad2(minutes))
}

// Hero relation text: "same time", "6h behind", "5h 30m ahead".
function formatRelation(diffMinutes) {
  if (!isFinite(diffMinutes) || diffMinutes === 0) return "same time"
  var abs = Math.round(Math.abs(diffMinutes))
  var hours = Math.floor(abs / 60)
  var minutes = abs % 60
  var magnitude = hours === 0
    ? minutes + "m"
    : (minutes === 0 ? hours + "h" : hours + "h " + minutes + "m")
  return magnitude + (diffMinutes > 0 ? " ahead" : " behind")
}

// Whole-day difference between two wall-clock Dates, compared by calendar
// date rather than elapsed hours so a zone a few hours away but past
// midnight still reads +1d/-1d.
function dayDelta(zoneDate, localDate) {
  var zoneMidnight = Date.UTC(zoneDate.getFullYear(), zoneDate.getMonth(), zoneDate.getDate())
  var localMidnight = Date.UTC(localDate.getFullYear(), localDate.getMonth(), localDate.getDate())
  return Math.round((zoneMidnight - localMidnight) / MS_PER_DAY)
}

function formatDayMarker(delta) {
  if (delta === 0) return ""
  return (delta > 0 ? "+" : "") + delta + "d"
}

// One line per requested zone from the batched `TZ=<zone> date +%z`
// (or the literal "INVALID" the shell script prints for a name that has no
// file under /usr/share/zoneinfo). A short read, a garbled line, or
// "INVALID" all come back null rather than throwing.
function parseOffsetToken(token) {
  var match = /^([+-])(\d{2})(\d{2})$/.exec(String(token || "").replace(/^\s+|\s+$/g, ""))
  if (!match) return null
  var sign = match[1] === "-" ? -1 : 1
  return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10))
}

function parseOffsetOutput(raw, count) {
  var lines = String(raw || "").split("\n")
  var out = []
  for (var i = 0; i < count; i++) out.push(parseOffsetToken(lines[i]))
  return out
}

// Maps a batched offset probe's stdout onto the zone list as it stands when
// the result arrives, rather than onto whatever the list happened to be
// when the probe was launched. `launchZones` is the snapshot the command
// was actually built from (positional: line i answers launchZones[i]);
// `currentZones` is `root.zones` right now, which may have gained, lost, or
// reordered entries while the process was in flight. A zone is matched by
// timezone+name -- the same pair addZone/findZoneIndex treat as identity --
// so a removal or reorder can never hand one zone's line to another.
//
// A zone that was in flight but isn't in `launchZones` (added mid-probe)
// keeps its entry from `previousOffsets` if it had one, or is left out
// entirely if not; either way the caller re-runs the probe immediately
// rather than waiting out the 60-second timer, so this is a one-tick gap,
// not a stale value that sticks around.
function applyOffsetOutput(launchZones, rawOutput, currentZones, previousOffsets) {
  var values = parseOffsetOutput(rawOutput, launchZones.length)
  var byIdentity = {}
  for (var i = 0; i < launchZones.length; i++) {
    byIdentity[launchZones[i].timezone + "\u0000" + launchZones[i].name] = values[i]
  }
  var prev = previousOffsets || {}
  var next = {}
  for (var j = 0; j < currentZones.length; j++) {
    var zone = currentZones[j]
    var key = zone.timezone + "\u0000" + zone.name
    if (key in byIdentity) {
      next[zone.timezone] = byIdentity[key]
    } else if (zone.timezone in prev) {
      next[zone.timezone] = prev[zone.timezone]
    }
  }
  return next
}

// True only for a value that is actually a JS number and a positive whole
// number -- "3", 3.5, 0, -1, NaN, true and "auto" are all rejected so they
// fall through to the auto rule below rather than being coerced.
function isPositiveInteger(value) {
  return typeof value === "number" && isFinite(value) && value > 0 && Math.floor(value) === value
}

// How many saved zones the bar shows inline before collapsing the rest into
// a trailing " +N". `maxInlineSetting` is the widget's raw `maxInline`
// value from shell.json (anything at all, including garbage from a hand
// edit); `screenWidth` is the width in pixels of the screen this bar
// instance is rendered on. A positive-integer setting wins outright, capped
// to however many zones actually exist (asking for more than that isn't a
// cap, it's a no-op). Anything else -- missing, "auto", or garbage -- falls
// back to the width rule: 2 on a screen narrower than 1400px, 4 otherwise.
// An unknown width (0 or non-finite, e.g. before the screen has reported
// one) is treated as not-narrow, matching the "4 otherwise" default rather
// than guessing the tighter cap.
function resolveInlineCount(maxInlineSetting, screenWidth, zoneCount) {
  if (zoneCount <= 0) return 0
  var requested
  if (isPositiveInteger(maxInlineSetting)) {
    requested = maxInlineSetting
  } else {
    var width = typeof screenWidth === "number" && isFinite(screenWidth) ? screenWidth : 0
    requested = (width > 0 && width < 1400) ? 2 : 4
  }
  return Math.min(requested, zoneCount)
}

// Open-Meteo geocoding response -> add-zone suggestions. A result missing
// `timezone` (confirmed to happen for non-city features like a heliport) is
// skipped rather than offered with no way to use it.
function parseGeocodingResults(raw) {
  try {
    var data = JSON.parse(String(raw || "{}"))
    var results = data.results
    if (!results || !results.length) return []

    var out = []
    for (var i = 0; i < results.length; i++) {
      var r = results[i]
      if (!r || !r.name || !r.timezone || !isValidTimezoneFormat(r.timezone)) continue
      var parts = [r.name, r.admin1, r.country].filter(function(part) { return !!part })
      out.push({
        name: String(r.name),
        country: String(r.country || ""),
        timezone: String(r.timezone),
        display: parts.join(", ")
      })
    }
    return out
  } catch (e) {
    return []
  }
}

if (typeof module !== "undefined") {
  module.exports = {
    KNOWN_CITY_LABELS: KNOWN_CITY_LABELS,
    DIACRITIC_FOLD_MAP: DIACRITIC_FOLD_MAP,
    foldDiacritics: foldDiacritics,
    deriveLabel: deriveLabel,
    isValidTimezoneFormat: isValidTimezoneFormat,
    defaultZones: defaultZones,
    normalizeZone: normalizeZone,
    normalizeZones: normalizeZones,
    normalizeActive: normalizeActive,
    normalizeSettings: normalizeSettings,
    activeIndex: activeIndex,
    stepActive: stepActive,
    findZoneIndex: findZoneIndex,
    addZone: addZone,
    removeZoneAt: removeZoneAt,
    zoneWallClockDate: zoneWallClockDate,
    formatSignedOffset: formatSignedOffset,
    formatRelation: formatRelation,
    dayDelta: dayDelta,
    formatDayMarker: formatDayMarker,
    parseOffsetToken: parseOffsetToken,
    parseOffsetOutput: parseOffsetOutput,
    applyOffsetOutput: applyOffsetOutput,
    isPositiveInteger: isPositiveInteger,
    resolveInlineCount: resolveInlineCount,
    parseGeocodingResults: parseGeocodingResults
  }
}

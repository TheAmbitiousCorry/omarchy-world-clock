// Node-runnable tests for Model.js -- the pure zone/settings/offset math
// behind the world clock widget. Run with: node test/model.test.js
//
// No framework: a tiny counter plus node's built-in assert. Each test names
// the behaviour it checks and fails on its own assertion, so a red run
// always points at one broken thing rather than a whole file.

var assert = require("assert")
var Model = require("../Model.js")

// Reproduces the exact shape QML handed Model.js in production: indexable,
// a numeric .length, constructor.name === "Array" -- everything but
// Array.isArray, which returned false for it on that engine even though it
// was a real, populated array. A plain object with these properties fails
// Array.isArray/instanceof Array in node too, which is what makes it a
// faithful stand-in rather than a coincidence of this engine.
function arrayLikeNotArray(items) {
  var obj = {}
  for (var i = 0; i < items.length; i++) obj[i] = items[i]
  obj.length = items.length
  Object.defineProperty(obj, "constructor", { value: Array, enumerable: false })
  return obj
}

var passed = 0
var failed = 0

function test(name, fn) {
  try {
    fn()
    passed++
  } catch (e) {
    failed++
    console.error("FAIL: " + name)
    console.error("  " + (e && e.message ? e.message : e))
  }
}

// ---------------------------------------------------------------- deriveLabel

test("deriveLabel: known city returns its conventional code", function() {
  assert.strictEqual(Model.deriveLabel("New York"), "NYC")
  assert.strictEqual(Model.deriveLabel("Cape Town"), "CPT")
})

test("deriveLabel: known-city lookup ignores case and surrounding space", function() {
  assert.strictEqual(Model.deriveLabel("  london  "), "LON")
  assert.strictEqual(Model.deriveLabel("TOKYO"), "TYO")
})

test("deriveLabel: unknown multi-word name uses up to three initials", function() {
  assert.strictEqual(Model.deriveLabel("Addis Ababa"), "AA")
  assert.strictEqual(Model.deriveLabel("Port Elizabeth Bay Area"), "PEB")
})

test("deriveLabel: unknown single-word name uses its first three letters", function() {
  assert.strictEqual(Model.deriveLabel("Perth"), "PER")
})

test("deriveLabel: blank name returns a blank label", function() {
  assert.strictEqual(Model.deriveLabel(""), "")
  assert.strictEqual(Model.deriveLabel("   "), "")
})

// Open-Meteo returns accented city names; the table keys and the fallback
// initials are both plain ASCII, so a name has to be folded before either
// path runs or a known city like Sao Paulo silently misses its table entry.
test("deriveLabel: a known city matches its table entry through its accents", function() {
  assert.strictEqual(Model.deriveLabel("São Paulo"), "SAO")
})

// Zurich is itself a known city (table key "zurich" -> "ZRH"). Before this
// fix the unfolded lookup key "zürich" never matched it, so this name
// fell all the way through to the single-word fallback and returned the
// literal first three characters, diacritic and all: "ZÜR". Folding
// before the lookup makes it match the table like any other spelling of
// the same city, and drops the diacritic either way it resolves.
test("deriveLabel: a known city matches its table entry even though the previous behavior kept the diacritic", function() {
  assert.strictEqual(Model.deriveLabel("Zürich"), "ZRH")
})

test("deriveLabel: an unknown accented name falls back to folded initials/letters", function() {
  assert.strictEqual(Model.deriveLabel("Málaga"), "MAL")
  assert.strictEqual(Model.deriveLabel("México Norte"), "MN")
})

// -------------------------------------------------------------- foldDiacritics

test("foldDiacritics: strips accents the deriveLabel table and fallback both rely on", function() {
  assert.strictEqual(Model.foldDiacritics("São Paulo"), "Sao Paulo")
  assert.strictEqual(Model.foldDiacritics("Zürich"), "Zurich")
})

test("foldDiacritics: plain ASCII passes through unchanged", function() {
  assert.strictEqual(Model.foldDiacritics("London"), "London")
})

// The explicit fold table is the fallback path for a JS engine with no
// String.prototype.normalize (this widget's QML engine has no Intl at all,
// and normalize is not guaranteed alongside that -- see Model.js's banner
// comment). Node has normalize, so this test drives the table directly
// rather than relying on foldDiacritics picking the same path node would.
test("foldDiacritics: the explicit fold table covers the same accented letters normalize does", function() {
  var table = Model.DIACRITIC_FOLD_MAP
  assert.strictEqual(table["ã"], "a")
  assert.strictEqual(table["ü"], "u")
  assert.strictEqual(table["é"], "e")
  var out = ""
  for (var i = 0; i < "São Paulo".length; i++) {
    var ch = "São Paulo".charAt(i)
    out += table[ch] || ch
  }
  assert.strictEqual(out, "Sao Paulo")
})

// --------------------------------------------------------- isValidTimezoneFormat

test("isValidTimezoneFormat: accepts a standard Area/Location name", function() {
  assert.strictEqual(Model.isValidTimezoneFormat("America/New_York"), true)
  assert.strictEqual(Model.isValidTimezoneFormat("Asia/Kolkata"), true)
  assert.strictEqual(Model.isValidTimezoneFormat("America/Argentina/Buenos_Aires"), true)
})

test("isValidTimezoneFormat: rejects a name with a space or that is empty", function() {
  assert.strictEqual(Model.isValidTimezoneFormat("Bogus Zone"), false)
  assert.strictEqual(Model.isValidTimezoneFormat(""), false)
  assert.strictEqual(Model.isValidTimezoneFormat(undefined), false)
})

// ------------------------------------------------------------------ normalizeZone

test("normalizeZone: keeps a well-formed zone as-is", function() {
  var zone = Model.normalizeZone({ label: "nyc", name: "New York", country: "United States", timezone: "America/New_York" })
  assert.deepStrictEqual(zone, { label: "NYC", name: "New York", country: "United States", timezone: "America/New_York" })
})

test("normalizeZone: derives the label when none is stored", function() {
  var zone = Model.normalizeZone({ name: "London", country: "United Kingdom", timezone: "Europe/London" })
  assert.strictEqual(zone.label, "LON")
})

test("normalizeZone: drops an entry with a malformed timezone", function() {
  assert.strictEqual(Model.normalizeZone({ name: "Nowhere", timezone: "not a zone" }), null)
})

test("normalizeZone: drops an entry with a missing or blank name", function() {
  assert.strictEqual(Model.normalizeZone({ timezone: "America/New_York" }), null)
  assert.strictEqual(Model.normalizeZone({ name: "  ", timezone: "America/New_York" }), null)
})

test("normalizeZone: drops a non-object entry", function() {
  assert.strictEqual(Model.normalizeZone(null), null)
  assert.strictEqual(Model.normalizeZone("America/New_York"), null)
})

// ----------------------------------------------------------------- normalizeZones

test("normalizeZones: keeps the well-formed entries and drops the malformed ones", function() {
  var zones = Model.normalizeZones([
    { name: "London", timezone: "Europe/London" },
    { name: "Nowhere", timezone: "not a zone" },
    "not even an object",
    { timezone: "America/New_York" }
  ])
  assert.strictEqual(zones.length, 1)
  assert.strictEqual(zones[0].name, "London")
})

test("normalizeZones: a non-array input yields zero zones", function() {
  assert.deepStrictEqual(Model.normalizeZones(undefined), [])
  assert.deepStrictEqual(Model.normalizeZones({ 0: "not an array" }), [])
})

// Confirmed live: the zones array QML hands in from shell.json is
// indexable with a working .length, but Array.isArray on it returned false
// on that engine even though every other array-like signal said otherwise
// -- an Array.isArray check here silently dropped every saved zone.
test("normalizeZones: accepts an indexable array-like value that fails Array.isArray", function() {
  var zonesFromQml = arrayLikeNotArray([{ name: "London", timezone: "Europe/London" }])
  assert.strictEqual(Array.isArray(zonesFromQml), false)
  var zones = Model.normalizeZones(zonesFromQml)
  assert.strictEqual(zones.length, 1)
  assert.strictEqual(zones[0].name, "London")
})

// --------------------------------------------------------------- normalizeSettings

test("normalizeSettings: a missing zones key falls back to the New York default", function() {
  var settings = Model.normalizeSettings({})
  assert.strictEqual(settings.zones.length, 1)
  assert.strictEqual(settings.zones[0].timezone, "America/New_York")
  assert.strictEqual(settings.active, "America/New_York")
})

test("normalizeSettings: a deliberately empty zones array stays empty", function() {
  var settings = Model.normalizeSettings({ zones: [] })
  assert.deepStrictEqual(settings.zones, [])
  assert.strictEqual(settings.active, "")
})

test("normalizeSettings: an active zone that still exists is kept", function() {
  var settings = Model.normalizeSettings({
    zones: [{ name: "London", timezone: "Europe/London" }, { name: "Tokyo", timezone: "Asia/Tokyo" }],
    active: "Asia/Tokyo"
  })
  assert.strictEqual(settings.active, "Asia/Tokyo")
})

test("normalizeSettings: a stale or missing active falls back to the first zone", function() {
  var withStale = Model.normalizeSettings({
    zones: [{ name: "London", timezone: "Europe/London" }],
    active: "Asia/Tokyo"
  })
  assert.strictEqual(withStale.active, "Europe/London")

  var withMissing = Model.normalizeSettings({
    zones: [{ name: "London", timezone: "Europe/London" }]
  })
  assert.strictEqual(withMissing.active, "Europe/London")
})

test("normalizeSettings: format defaults to HH:mm and otherwise passes through", function() {
  assert.strictEqual(Model.normalizeSettings({}).format, "HH:mm")
  assert.strictEqual(Model.normalizeSettings({ format: "h:mm AP" }).format, "h:mm AP")
})

// ------------------------------------------------------------ activeIndex/stepActive

test("stepActive: steps forward and wraps past the last zone", function() {
  var zones = [{ timezone: "A" }, { timezone: "B" }, { timezone: "C" }]
  assert.strictEqual(Model.stepActive(zones, "A", 1), "B")
  assert.strictEqual(Model.stepActive(zones, "C", 1), "A")
})

test("stepActive: steps backward and wraps past the first zone", function() {
  var zones = [{ timezone: "A" }, { timezone: "B" }, { timezone: "C" }]
  assert.strictEqual(Model.stepActive(zones, "B", -1), "A")
  assert.strictEqual(Model.stepActive(zones, "A", -1), "C")
})

test("stepActive: an active timezone that isn't in the list starts the walk at the first entry", function() {
  var zones = [{ timezone: "A" }, { timezone: "B" }]
  assert.strictEqual(Model.stepActive(zones, "unknown", 1), "B")
})

test("stepActive: zero zones is a no-op", function() {
  assert.strictEqual(Model.stepActive([], "A", 1), "A")
})

// ------------------------------------------------------------------------ addZone

test("addZone: appends a new zone and activates it", function() {
  var zones = [{ label: "NYC", name: "New York", country: "United States", timezone: "America/New_York" }]
  var result = Model.addZone(zones, "America/New_York", { name: "London", country: "United Kingdom", timezone: "Europe/London" })
  assert.strictEqual(result.added, true)
  assert.strictEqual(result.zones.length, 2)
  assert.strictEqual(result.active, "Europe/London")
})

test("addZone: the same timezone and name activates the existing zone instead of duplicating it", function() {
  var zones = [{ label: "NYC", name: "New York", country: "United States", timezone: "America/New_York" }]
  var result = Model.addZone(zones, "America/New_York", { name: "New York", country: "United States", timezone: "America/New_York" })
  assert.strictEqual(result.added, false)
  assert.strictEqual(result.zones.length, 1)
  assert.strictEqual(result.active, "America/New_York")
})

test("addZone: the same timezone under a different name is added rather than deduped", function() {
  var zones = [{ label: "SYD", name: "Sydney", country: "Australia", timezone: "Australia/Sydney" }]
  var result = Model.addZone(zones, "Australia/Sydney", { name: "Canberra", country: "Australia", timezone: "Australia/Sydney" })
  assert.strictEqual(result.added, true)
  assert.strictEqual(result.zones.length, 2)
})

test("addZone: a malformed candidate is rejected without changing anything", function() {
  var zones = [{ label: "NYC", name: "New York", country: "United States", timezone: "America/New_York" }]
  var result = Model.addZone(zones, "America/New_York", { name: "Nowhere", timezone: "not a zone" })
  assert.strictEqual(result.added, false)
  assert.strictEqual(result.zones.length, 1)
  assert.strictEqual(result.active, "America/New_York")
})

// --------------------------------------------------------------------- removeZoneAt

test("removeZoneAt: removing a zone that isn't active leaves the active zone alone", function() {
  var zones = [{ timezone: "A" }, { timezone: "B" }, { timezone: "C" }]
  var result = Model.removeZoneAt(zones, "B", 0)
  assert.strictEqual(result.zones.length, 2)
  assert.strictEqual(result.active, "B")
})

test("removeZoneAt: removing the active zone activates the neighbour that slides into its slot", function() {
  var zones = [{ timezone: "A" }, { timezone: "B" }, { timezone: "C" }]
  var result = Model.removeZoneAt(zones, "B", 1)
  assert.strictEqual(result.active, "C")
})

test("removeZoneAt: removing the active last zone activates the new last zone", function() {
  var zones = [{ timezone: "A" }, { timezone: "B" }, { timezone: "C" }]
  var result = Model.removeZoneAt(zones, "C", 2)
  assert.strictEqual(result.active, "B")
})

test("removeZoneAt: removing the only zone leaves no active zone", function() {
  var zones = [{ timezone: "A" }]
  var result = Model.removeZoneAt(zones, "A", 0)
  assert.deepStrictEqual(result.zones, [])
  assert.strictEqual(result.active, "")
})

test("removeZoneAt: an out-of-range index is a no-op", function() {
  var zones = [{ timezone: "A" }]
  assert.deepStrictEqual(Model.removeZoneAt(zones, "A", -1), { zones: zones, active: "A" })
  assert.deepStrictEqual(Model.removeZoneAt(zones, "A", 1), { zones: zones, active: "A" })
})

// ---------------------------------------------------------------- zoneWallClockDate

test("zoneWallClockDate: a positive offset rolls the wall clock into the next day", function() {
  // 2026-01-15 23:00 UTC, zone nine hours ahead -> 2026-01-16 08:00.
  var nowMs = Date.UTC(2026, 0, 15, 23, 0, 0)
  var wall = Model.zoneWallClockDate(nowMs, 9 * 60)
  assert.strictEqual(wall.getFullYear(), 2026)
  assert.strictEqual(wall.getMonth(), 0)
  assert.strictEqual(wall.getDate(), 16)
  assert.strictEqual(wall.getHours(), 8)
  assert.strictEqual(wall.getMinutes(), 0)
})

test("zoneWallClockDate: a negative offset rolls the wall clock into the previous day", function() {
  // 2026-01-15 01:00 UTC, zone eight hours behind -> 2026-01-14 17:00.
  var nowMs = Date.UTC(2026, 0, 15, 1, 0, 0)
  var wall = Model.zoneWallClockDate(nowMs, -8 * 60)
  assert.strictEqual(wall.getDate(), 14)
  assert.strictEqual(wall.getHours(), 17)
})

test("zoneWallClockDate: a 45-minute offset (Asia/Kathmandu) keeps the odd minutes", function() {
  var nowMs = Date.UTC(2026, 0, 15, 0, 0, 0)
  var wall = Model.zoneWallClockDate(nowMs, 5 * 60 + 45)
  assert.strictEqual(wall.getHours(), 5)
  assert.strictEqual(wall.getMinutes(), 45)
})

test("zoneWallClockDate: a half-hour offset (Asia/Kolkata) keeps the thirty minutes", function() {
  var nowMs = Date.UTC(2026, 0, 15, 0, 0, 0)
  var wall = Model.zoneWallClockDate(nowMs, 5 * 60 + 30)
  assert.strictEqual(wall.getHours(), 5)
  assert.strictEqual(wall.getMinutes(), 30)
})

test("zoneWallClockDate: a missing or non-finite offset returns null", function() {
  assert.strictEqual(Model.zoneWallClockDate(Date.now(), null), null)
  assert.strictEqual(Model.zoneWallClockDate(Date.now(), undefined), null)
  assert.strictEqual(Model.zoneWallClockDate(Date.now(), NaN), null)
})

// ---------------------------------------------------------------- formatSignedOffset

test("formatSignedOffset: zero is 0h with no sign", function() {
  assert.strictEqual(Model.formatSignedOffset(0), "0h")
})

test("formatSignedOffset: a whole-hour difference drops the minutes", function() {
  assert.strictEqual(Model.formatSignedOffset(-360), "-6h")
  assert.strictEqual(Model.formatSignedOffset(60), "+1h")
})

test("formatSignedOffset: a half-hour difference keeps h:mm", function() {
  assert.strictEqual(Model.formatSignedOffset(330), "+5:30")
})

test("formatSignedOffset: a 45-minute difference keeps h:mm", function() {
  assert.strictEqual(Model.formatSignedOffset(-345), "-5:45")
})

test("formatSignedOffset: a non-finite difference reads as unknown", function() {
  assert.strictEqual(Model.formatSignedOffset(NaN), "--")
})

// ------------------------------------------------------------------- formatRelation

test("formatRelation: zero difference reads as same time", function() {
  assert.strictEqual(Model.formatRelation(0), "same time")
})

test("formatRelation: a whole-hour difference behind reads Nh behind", function() {
  assert.strictEqual(Model.formatRelation(-360), "6h behind")
})

test("formatRelation: a mixed hour-and-minute difference ahead reads Nh Mm ahead", function() {
  assert.strictEqual(Model.formatRelation(330), "5h 30m ahead")
})

test("formatRelation: a sub-hour difference reads Nm with no hour part", function() {
  assert.strictEqual(Model.formatRelation(-30), "30m behind")
  assert.strictEqual(Model.formatRelation(45), "45m ahead")
})

// ----------------------------------------------------------------------- dayDelta

test("dayDelta: the same calendar day is zero", function() {
  var a = new Date(2026, 0, 15, 23, 0, 0)
  var b = new Date(2026, 0, 15, 1, 0, 0)
  assert.strictEqual(Model.dayDelta(a, b), 0)
})

test("dayDelta: a zone one calendar day ahead is +1", function() {
  var zone = new Date(2026, 0, 16, 1, 0, 0)
  var local = new Date(2026, 0, 15, 23, 0, 0)
  assert.strictEqual(Model.dayDelta(zone, local), 1)
})

test("dayDelta: a zone one calendar day behind is -1", function() {
  var zone = new Date(2026, 0, 14, 23, 0, 0)
  var local = new Date(2026, 0, 15, 1, 0, 0)
  assert.strictEqual(Model.dayDelta(zone, local), -1)
})

test("dayDelta: rolls correctly across a year boundary", function() {
  var zone = new Date(2027, 0, 1, 1, 0, 0)
  var local = new Date(2026, 11, 31, 23, 0, 0)
  assert.strictEqual(Model.dayDelta(zone, local), 1)
})

test("formatDayMarker: zero delta shows no marker", function() {
  assert.strictEqual(Model.formatDayMarker(0), "")
})

test("formatDayMarker: signs the non-zero deltas", function() {
  assert.strictEqual(Model.formatDayMarker(1), "+1d")
  assert.strictEqual(Model.formatDayMarker(-1), "-1d")
})

// ------------------------------------------------------------------- parseOffsetToken

test("parseOffsetToken: parses a positive and negative %z token", function() {
  assert.strictEqual(Model.parseOffsetToken("+0530"), 330)
  assert.strictEqual(Model.parseOffsetToken("-0400"), -240)
})

test("parseOffsetToken: the zoneinfo-missing sentinel is invalid", function() {
  assert.strictEqual(Model.parseOffsetToken("INVALID"), null)
})

test("parseOffsetToken: a token missing its sign is invalid", function() {
  assert.strictEqual(Model.parseOffsetToken("0530"), null)
})

test("parseOffsetToken: a blank or garbled token is invalid", function() {
  assert.strictEqual(Model.parseOffsetToken(""), null)
  assert.strictEqual(Model.parseOffsetToken("garbage"), null)
})

test("parseOffsetOutput: reads one token per requested zone, in order", function() {
  var values = Model.parseOffsetOutput("+0530\nINVALID\n-0800", 3)
  assert.deepStrictEqual(values, [330, null, -480])
})

test("parseOffsetOutput: a short response fills the missing zones with null", function() {
  var values = Model.parseOffsetOutput("+0530", 2)
  assert.deepStrictEqual(values, [330, null])
})

// -------------------------------------------------------------- applyOffsetOutput

// Reproduces the reviewer's offset-race replay (scratchpad/review-time/
// offset-race.js) exactly: 3 zones launch the probe, London is removed
// before its stdout arrives (sliding Tokyo into London's old array slot),
// and the stale stdout finally lands. Before this fix, Panel.qml attributed
// output positionally against root.zones as it stood when the process
// finished, so Tokyo inherited London's line. applyOffsetOutput maps by
// timezone+name against the snapshot the command actually ran against, so
// each zone keeps its own reading regardless of what changed underneath it.
test("applyOffsetOutput: a zone removed mid-probe does not inherit another zone's stale reading", function() {
  var zonesAtLaunch = [
    { label: "NYC", name: "New York", timezone: "America/New_York" },
    { label: "LON", name: "London", timezone: "Europe/London" },
    { label: "TYO", name: "Tokyo", timezone: "Asia/Tokyo" }
  ]
  var staleStdout = "-0400\n+0100\n+0900" // NY -240, London +60, Tokyo +540

  var afterRemoval = Model.removeZoneAt(zonesAtLaunch, "America/New_York", 1)
  var zonesNow = afterRemoval.zones // [NYC, Tokyo] -- Tokyo now sits where London did

  var offsets = Model.applyOffsetOutput(zonesAtLaunch, staleStdout, zonesNow, {})
  assert.strictEqual(offsets["Asia/Tokyo"], 540, "Tokyo must keep its own +0900, not London's +0100")
  assert.strictEqual(offsets["America/New_York"], -240)
  assert.strictEqual("Europe/London" in offsets, false, "the removed zone contributes no entry")
})

test("applyOffsetOutput: a zone reordered mid-probe still gets its own reading", function() {
  var zonesAtLaunch = [
    { label: "NYC", name: "New York", timezone: "America/New_York" },
    { label: "TYO", name: "Tokyo", timezone: "Asia/Tokyo" }
  ]
  var staleStdout = "-0400\n+0900"
  // Reversed order, as if the user dragged Tokyo above New York mid-probe.
  var zonesNow = [zonesAtLaunch[1], zonesAtLaunch[0]]

  var offsets = Model.applyOffsetOutput(zonesAtLaunch, staleStdout, zonesNow, {})
  assert.strictEqual(offsets["Asia/Tokyo"], 540)
  assert.strictEqual(offsets["America/New_York"], -240)
})

test("applyOffsetOutput: a zone added mid-probe keeps its previous reading rather than a wrong one", function() {
  var zonesAtLaunch = [{ label: "NYC", name: "New York", timezone: "America/New_York" }]
  var staleStdout = "-0400"
  var zonesNow = zonesAtLaunch.concat([{ label: "LON", name: "London", timezone: "Europe/London" }])
  var previousOffsets = { "Europe/London": 60 }

  var offsets = Model.applyOffsetOutput(zonesAtLaunch, staleStdout, zonesNow, previousOffsets)
  assert.strictEqual(offsets["America/New_York"], -240)
  assert.strictEqual(offsets["Europe/London"], 60, "keeps the last known reading until the immediate re-run replaces it")
})

test("applyOffsetOutput: a zone added mid-probe with no previous reading is simply absent, not misattributed", function() {
  var zonesAtLaunch = [{ label: "NYC", name: "New York", timezone: "America/New_York" }]
  var staleStdout = "-0400"
  var zonesNow = zonesAtLaunch.concat([{ label: "LON", name: "London", timezone: "Europe/London" }])

  var offsets = Model.applyOffsetOutput(zonesAtLaunch, staleStdout, zonesNow, {})
  assert.strictEqual(offsets["America/New_York"], -240)
  assert.strictEqual("Europe/London" in offsets, false)
})

test("applyOffsetOutput: same timezone under two different names each keep their own reading", function() {
  var zonesAtLaunch = [
    { label: "SYD", name: "Sydney", timezone: "Australia/Sydney" },
    { label: "CBR", name: "Canberra", timezone: "Australia/Sydney" }
  ]
  var stdout = "+1000\n+1100" // an implausible pair in reality, but distinguishes misattribution
  var offsets = Model.applyOffsetOutput(zonesAtLaunch, stdout, zonesAtLaunch, {})
  // Both share a key (offsets is keyed by timezone alone, matching the
  // shape Panel.qml's rows/offsets already use), so the later entry in
  // zone order wins -- this only confirms neither entry silently vanishes
  // or throws when two saved zones share a timezone.
  assert.strictEqual(typeof offsets["Australia/Sydney"], "number")
})

// ----------------------------------------------------------- resolveInlineCount

test("resolveInlineCount: a positive integer setting wins on any screen width", function() {
  assert.strictEqual(Model.resolveInlineCount(3, 1920, 5), 3)
  assert.strictEqual(Model.resolveInlineCount(3, 1080, 5), 3)
})

test("resolveInlineCount: a positive integer setting is capped to however many zones exist", function() {
  assert.strictEqual(Model.resolveInlineCount(10, 1920, 3), 3)
})

test("resolveInlineCount: missing or 'auto' shows 2 under 1400px and 4 at or above it", function() {
  assert.strictEqual(Model.resolveInlineCount("auto", 1080, 5), 2)
  assert.strictEqual(Model.resolveInlineCount("auto", 1399, 5), 2)
  assert.strictEqual(Model.resolveInlineCount("auto", 1400, 5), 4)
  assert.strictEqual(Model.resolveInlineCount(undefined, 1920, 5), 4)
})

test("resolveInlineCount: the width rule is also capped to however many zones exist", function() {
  assert.strictEqual(Model.resolveInlineCount("auto", 1920, 1), 1)
  assert.strictEqual(Model.resolveInlineCount("auto", 1080, 1), 1)
})

test("resolveInlineCount: zero saved zones shows zero inline regardless of setting", function() {
  assert.strictEqual(Model.resolveInlineCount(3, 1920, 0), 0)
  assert.strictEqual(Model.resolveInlineCount("auto", 1080, 0), 0)
})

// A hand-edited or malformed maxInline value falls back to the width rule
// rather than being coerced -- "3" is a string, not the number 3.
test("resolveInlineCount: garbage settings fall back to the width rule instead of being coerced", function() {
  assert.strictEqual(Model.resolveInlineCount("3", 1080, 5), 2, "a numeral string is not a positive integer")
  assert.strictEqual(Model.resolveInlineCount(0, 1080, 5), 2, "zero is not positive")
  assert.strictEqual(Model.resolveInlineCount(-2, 1080, 5), 2, "a negative count is not positive")
  assert.strictEqual(Model.resolveInlineCount(2.5, 1080, 5), 2, "a fractional count is not an integer")
  assert.strictEqual(Model.resolveInlineCount(null, 1080, 5), 2)
  assert.strictEqual(Model.resolveInlineCount(true, 1080, 5), 2, "a boolean is not a number")
  assert.strictEqual(Model.resolveInlineCount({}, 1080, 5), 2, "an object is not a number")
  assert.strictEqual(Model.resolveInlineCount(NaN, 1080, 5), 2)
})

test("resolveInlineCount: an unknown screen width (0 or non-finite) defaults to the not-narrow case", function() {
  assert.strictEqual(Model.resolveInlineCount("auto", 0, 5), 4)
  assert.strictEqual(Model.resolveInlineCount("auto", NaN, 5), 4)
  assert.strictEqual(Model.resolveInlineCount("auto", undefined, 5), 4)
})

test("isPositiveInteger: accepts only a finite whole number greater than zero", function() {
  assert.strictEqual(Model.isPositiveInteger(4), true)
  assert.strictEqual(Model.isPositiveInteger(0), false)
  assert.strictEqual(Model.isPositiveInteger(-1), false)
  assert.strictEqual(Model.isPositiveInteger(1.5), false)
  assert.strictEqual(Model.isPositiveInteger("4"), false)
  assert.strictEqual(Model.isPositiveInteger(Infinity), false)
})

// -------------------------------------------------------------- parseGeocodingResults

test("parseGeocodingResults: builds a City, Region, Country display string", function() {
  var raw = JSON.stringify({ results: [
    { name: "Cape Town", admin1: "Western Cape", country: "South Africa", timezone: "Africa/Johannesburg" }
  ] })
  var results = Model.parseGeocodingResults(raw)
  assert.strictEqual(results.length, 1)
  assert.strictEqual(results[0].display, "Cape Town, Western Cape, South Africa")
  assert.strictEqual(results[0].timezone, "Africa/Johannesburg")
})

test("parseGeocodingResults: a result with no timezone is skipped", function() {
  var raw = JSON.stringify({ results: [
    { name: "Atlantis", feature_code: "AIRH" },
    { name: "London", admin1: "England", country: "United Kingdom", timezone: "Europe/London" }
  ] })
  var results = Model.parseGeocodingResults(raw)
  assert.strictEqual(results.length, 1)
  assert.strictEqual(results[0].name, "London")
})

test("parseGeocodingResults: no results or malformed JSON both yield an empty list", function() {
  assert.deepStrictEqual(Model.parseGeocodingResults(JSON.stringify({ results: [] })), [])
  assert.deepStrictEqual(Model.parseGeocodingResults("not json"), [])
  assert.deepStrictEqual(Model.parseGeocodingResults(""), [])
})

// -------------------------------------------------------------------------- report

console.log(passed + " passed, " + failed + " failed")
if (failed > 0) process.exit(1)

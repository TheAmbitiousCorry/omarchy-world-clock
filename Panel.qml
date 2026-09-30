import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// The world clock's switch-and-add popup: a hero reading for the active
// zone, every saved zone listed below it, and a search field that geocodes
// a new one through Open-Meteo. Same hero-over-list shape as the weather
// and clock panels.
//
// This engine's Date has no working timeZone support (Intl is entirely
// absent, and Date.toLocaleString's timeZone option is silently ignored),
// so every zone's offset comes from shelling out to `TZ=<zone> date +%z`
// instead (see zoneOffsetProc). All the settings math and shell-out
// parsing that don't need that offset lives in Model.js.
Panel {
  id: root
  moduleName: "kr34t1v.world-clock"
  ipcTarget: "kr34t1v.world-clock"
  manageIpc: false

  property var anchorItem: null

  // The bar tracks the widget mounted in its slot (BarWidget.qml), not this
  // nested panel. Everything the bar identifies a panel by has to be that
  // widget: the popout coordinator (and with it the open-panel dot under the
  // pill) compares against `slot.activeItem`, and switchPanelFrom looks the
  // slot up the same way.
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root

  // Guarded so the popup renders before the bar is injected: the Loader
  // that hosts this Panel is active immediately, and bar/settings only
  // arrive once BarWidget.qml's injectPanel() runs on the following tick.
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property color contentUrgent: bar ? bar.urgent : Color.urgent
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property var normalized: Model.normalizeSettings(root.settings)
  readonly property var zones: normalized.zones
  readonly property string active: normalized.active
  readonly property string format: normalized.format

  readonly property var activeZone: {
    var index = Model.activeIndex(zones, active)
    return index === -1 ? null : zones[index]
  }

  // One offset per saved zone in minutes east of UTC, refreshed on open and
  // every minute after. null means the last probe couldn't read that zone.
  property var offsets: ({})

  property date now: clock.date
  readonly property int localOffsetMinutes: -now.getTimezoneOffset()

  // Every row's derived display fields, recomputed whenever the clock ticks,
  // the offsets refresh, or the saved zones change.
  readonly property var rows: {
    var out = []
    for (var i = 0; i < zones.length; i++) {
      var zone = zones[i]
      var offset = offsets[zone.timezone]
      var wall = Model.zoneWallClockDate(now.getTime(), offset)
      var diff = (offset === null || offset === undefined) ? null : offset - localOffsetMinutes
      out.push({
        timezone: zone.timezone,
        label: zone.label,
        name: zone.name,
        isActive: zone.timezone === active,
        timeText: wall ? Qt.formatDateTime(wall, format) : "--:--",
        dayMarker: wall ? Model.formatDayMarker(Model.dayDelta(wall, now)) : "",
        offsetText: diff === null ? "--" : Model.formatSignedOffset(diff),
        relationText: diff === null ? "" : Model.formatRelation(diff)
      })
    }
    return out
  }

  readonly property var heroRow: {
    if (!activeZone) return null
    for (var i = 0; i < rows.length; i++) if (rows[i].timezone === activeZone.timezone) return rows[i]
    return null
  }

  readonly property string heroDateText: {
    if (!activeZone) return ""
    var wall = Model.zoneWallClockDate(now.getTime(), offsets[activeZone.timezone])
    return wall ? Qt.formatDateTime(wall, "ddd d MMM") : ""
  }

  function open() {
    setCenterHoverRevealSuppressed(false)
    refreshOffsets()
    root.controller.show()
    // Set after showing, not before: showing hands the popout coordinator
    // over, which closes whichever panel was open, and that close clears the
    // shared flag. Deferring means the panel taking over always wins, while
    // a handoff to a panel that does not manage the flag still leaves it
    // cleared rather than stuck on.
    Qt.callLater(function() {
      if (root.opened) setCenterHoverRevealSuppressed(true)
    })
  }

  function close() {
    setCenterHoverRevealSuppressed(false)
    searchField.text = ""
    root.suggestions = []
    root.searchError = ""
    root.controller.hide()
  }

  function toggle() {
    if (root.opened) root.close()
    else root.open()
  }

  // Keyboard path into the add-zone field, for the `add` IPC call: open the
  // popup, then focus the search field once it's actually shown. Deferred
  // the same way weather's startEditingLocation defers locationField's
  // focus -- open() has just called controller.show(), and the field can't
  // take active focus until that mapping has gone through.
  function focusSearch() {
    Qt.callLater(function() {
      searchField.forceActiveFocus()
    })
  }

  function switchPanel(direction) {
    if (root.bar && typeof root.bar.switchPanelFrom === "function")
      return root.bar.switchPanelFrom(root.barIdentity, direction)
    return false
  }

  // Summoning by hotkey moves no pointer, so a hover the bar was still
  // holding must not keep the center indicators revealed behind the panel.
  function setCenterHoverRevealSuppressed(value) {
    if (root.bar && typeof root.bar.setCenterHoverRevealSuppressed === "function")
      root.bar.setCenterHoverRevealSuppressed(value)
    else if (root.bar && "centerHoverRevealSuppressed" in root.bar)
      root.bar.centerHoverRevealSuppressed = value
  }

  // Screen this bar instance renders on. The attached Screen property tracks
  // whatever window an item currently belongs to, no explicit wiring needed
  // (the tray widget in the user's bar clone relies on the same attached
  // property for devicePixelRatio); each monitor's widget instance sees its
  // own screen's width here, which is what the inline-zone cap needs.
  readonly property real screenWidth: Screen.width

  // ---- Bar label. "LABEL time" per saved zone, joined for a horizontal
  //      bar, capped to maxInlineCount with the rest folded into a
  //      trailing " +N" so a narrow monitor's bar can't run its text under
  //      the tray/other icons. BarWidget falls back to a bare icon on its
  //      own when this is empty (no zones) or the bar is vertical.
  readonly property int maxInlineCount: Model.resolveInlineCount(root.setting("maxInline", "auto"), root.screenWidth, rows.length)

  function barLine() {
    var parts = []
    for (var i = 0; i < maxInlineCount; i++) parts.push(rows[i].label + " " + rows[i].timeText)
    var line = parts.join(" · ")
    var hidden = rows.length - maxInlineCount
    if (hidden > 0) line += " +" + hidden
    return line
  }

  function stepActive(direction) {
    if (zones.length < 2) return
    persist({ active: Model.stepActive(zones, active, direction) })
  }

  function activateZone(timezone) {
    if (timezone === active) return
    persist({ active: timezone })
  }

  function removeZoneAt(index) {
    var result = Model.removeZoneAt(zones, active, index)
    persist({ zones: result.zones, active: result.active })
  }

  // ---- Settings writes. Every write starts from the widget's current
  //      shell.json entry so a key this plugin doesn't know about survives.
  function persist(values) {
    var entry = { id: root.moduleName }
    for (var key in root.settings) if (key !== "id") entry[key] = root.settings[key]
    for (var changed in values) entry[changed] = values[changed]

    // Applied locally first so the popup redraws on the click itself; the
    // shell.json write comes back through the bar as the same value.
    root.settings = entry
    if (root.hostWidget && "settings" in root.hostWidget) root.hostWidget.settings = entry
    if (root.bar && root.bar.shell && typeof root.bar.shell.updateEntryInline === "function")
      root.bar.shell.updateEntryInline(root.moduleName, entry)
  }

  // ---- Offset probe. One batched process covers every saved zone; each
  //      run reads the live offset right now, so a DST change is reflected
  //      within a minute rather than staying stale until the shell restarts.
  //      A name with no file under /usr/share/zoneinfo prints "INVALID"
  //      rather than ever reaching `date`, on top of the format check
  //      already applied when the zone was saved.
  //
  //      `zonesAtLaunch` snapshots exactly which zones (and in what order)
  //      the running command was built from, so the result can be mapped
  //      back onto them by identity rather than by root.zones' shape at
  //      whatever moment the process happens to finish -- root.zones can
  //      have gained, lost, or reordered entries by then. If a zone list
  //      change arrives while a probe is already running, `refreshPending`
  //      remembers it and refreshOffsets() re-launches immediately once the
  //      in-flight probe's result is applied, instead of leaving the list
  //      stale until the next 60-second tick.
  property var zonesAtLaunch: []
  property bool refreshPending: false

  function refreshOffsets() {
    if (zones.length === 0) {
      refreshPending = false
      return
    }
    if (zoneOffsetProc.running) {
      refreshPending = true
      return
    }
    refreshPending = false
    zonesAtLaunch = zones.slice()
    var names = []
    for (var i = 0; i < zonesAtLaunch.length; i++) names.push(zonesAtLaunch[i].timezone)
    zoneOffsetProc.command = ["bash", "-c",
      "for z in \"$@\"; do if [ -e \"/usr/share/zoneinfo/$z\" ]; then TZ=\"$z\" date +%z; else echo INVALID; fi; done",
      "--"
    ].concat(names)
    zoneOffsetProc.running = true
  }

  Process {
    id: zoneOffsetProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        root.offsets = Model.applyOffsetOutput(root.zonesAtLaunch, text, root.zones, root.offsets)
        if (root.refreshPending) root.refreshOffsets()
      }
    }
  }

  SystemClock {
    id: clock
    precision: SystemClock.Minutes
    onDateChanged: root.now = date
  }

  Timer {
    id: offsetRefreshTimer
    interval: 60000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refreshOffsets()
  }

  onZonesChanged: refreshOffsets()

  // ---- Add-zone search. Debounced Open-Meteo geocoding, the same idiom as
  //      the weather panel's location search: one curl at a time, the
  //      latest query wins if the field moved on while a fetch was in
  //      flight.
  property var suggestions: []
  property int suggestionIndex: 0
  property string searchError: ""
  property string pendingQuery: ""
  property string activeQuery: ""

  function requestSearch() {
    var query = searchField.text.replace(/^\s+|\s+$/g, "")
    searchError = ""
    if (query.length < 2) {
      suggestions = []
      return
    }
    pendingQuery = query
    if (!searchProc.running) startSearch()
  }

  function startSearch() {
    activeQuery = pendingQuery
    searchProc.command = ["curl", "-fsS", "--max-time", "5",
      "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(activeQuery) + "&count=5&language=en&format=json"]
    searchProc.running = true
  }

  function pickSuggestion(suggestion) {
    if (!suggestion) return
    var result = Model.addZone(zones, active, suggestion)
    persist({ zones: result.zones, active: result.active })
    searchField.text = ""
    suggestions = []
    searchField.forceActiveFocus()
  }

  Process {
    id: searchProc
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: {
        var raw = String(text || "").trim()
        if (!raw) {
          root.suggestions = []
          root.searchError = "Couldn't reach the network"
        } else {
          var parsed = Model.parseGeocodingResults(raw)
          root.suggestions = parsed
          root.searchError = parsed.length === 0 ? "No matches" : ""
        }
        root.suggestionIndex = 0
        if (root.pendingQuery !== root.activeQuery) Qt.callLater(root.startSearch)
      }
    }
  }

  Timer {
    id: searchDebounce
    interval: 300
    onTriggered: root.requestSearch()
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(340))
    contentHeight: panel.fittedContentHeight(worldClockColumn.implicitHeight)

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      blocked: searchField.activeFocus
      onMoveRequested: function(dx, dy) { if (dx !== 0) root.stepActive(dx) }
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Flickable {
        id: worldClockScroll
        anchors.fill: parent
        contentWidth: width
        contentHeight: worldClockColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height

        Column {
          id: worldClockColumn
          width: worldClockScroll.width
          spacing: Style.space(14)

          // ---- Hero: prev/next either side of the active zone's city,
          //      the time large underneath, then its date and relation to
          //      local time.
          Item {
            visible: root.zones.length > 0
            width: parent.width
            height: heroColumn.implicitHeight

            Column {
              id: heroColumn
              width: parent.width
              spacing: Style.space(4)

              Item {
                id: cityNav
                anchors.horizontalCenter: parent.horizontalCenter
                width: cityLabel.width
                height: cityLabel.implicitHeight + Style.space(10)

                Text {
                  id: cityLabel
                  textFormat: Text.PlainText
                  anchors.centerIn: parent
                  width: Style.space(190)
                  horizontalAlignment: Text.AlignHCenter
                  text: root.activeZone ? root.activeZone.name : ""
                  color: root.contentForeground
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.heading
                  font.bold: true
                }

                PanelActionButton {
                  visible: root.zones.length > 1
                  anchors.left: parent.left
                  anchors.leftMargin: -Style.space(8)
                  anchors.verticalCenter: parent.verticalCenter
                  iconText: "󰅁"
                  tooltipText: "Previous zone"
                  foreground: root.contentForeground
                  fontFamily: root.contentFontFamily
                  onClicked: root.stepActive(-1)
                }

                PanelActionButton {
                  visible: root.zones.length > 1
                  anchors.right: parent.right
                  anchors.rightMargin: -Style.space(8)
                  anchors.verticalCenter: parent.verticalCenter
                  iconText: "󰅂"
                  tooltipText: "Next zone"
                  foreground: root.contentForeground
                  fontFamily: root.contentFontFamily
                  onClicked: root.stepActive(1)
                }
              }

              Text {
                textFormat: Text.PlainText
                anchors.horizontalCenter: parent.horizontalCenter
                text: root.heroRow ? root.heroRow.timeText : "--:--"
                color: root.contentForeground
                font.family: root.contentFontFamily
                // Hero time read-out; deliberately oversized, outside the
                // Style.font.* scale, matching the weather panel's hero
                // temperature.
                font.pixelSize: 52
                font.bold: true
              }

              Text {
                textFormat: Text.PlainText
                anchors.horizontalCenter: parent.horizontalCenter
                text: root.heroDateText + (root.heroRow && root.heroRow.relationText !== "" ? " · " + root.heroRow.relationText : "")
                color: Qt.darker(root.contentForeground, 1.4)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.body
              }
            }
          }

          Text {
            visible: root.zones.length === 0
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            wrapMode: Text.WordWrap
            text: "Add a time zone below to get started."
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            font.italic: true
          }

          // ---- Divider between the hero and the saved-zone list.
          Rectangle {
            visible: root.zones.length > 0
            width: parent.width
            height: Style.spacing.hairline
            color: root.contentForeground
            opacity: 0.12
          }

          // ---- List: one row per saved zone. A dot marks the active one;
          //      clicking a row activates it; the remove control shows on
          //      hover.
          Column {
            visible: root.zones.length > 0
            width: parent.width
            spacing: Style.space(2)

            Repeater {
              model: root.rows

              Rectangle {
                id: zoneRow
                required property var modelData
                required property int index
                width: parent.width
                height: rowContent.implicitHeight + Style.space(10)
                radius: Style.cornerRadius
                color: rowMouse.containsMouse ? Style.hoverFillFor(root.contentForeground, Color.accent) : "transparent"

                MouseArea {
                  id: rowMouse
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.activateZone(zoneRow.modelData.timezone)
                }

                // Left cluster: active dot + city name. Its right edge stops
                // at valueColumns so a long name elides instead of running
                // into the time/offset columns.
                Row {
                  id: rowContent
                  anchors.left: parent.left
                  anchors.right: valueColumns.left
                  anchors.leftMargin: Style.space(14)
                  anchors.rightMargin: Style.space(10)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(10)

                  Rectangle {
                    width: Style.space(6)
                    height: Style.space(6)
                    radius: width / 2
                    anchors.verticalCenter: parent.verticalCenter
                    color: zoneRow.modelData.isActive ? root.contentForeground : "transparent"
                    border.width: zoneRow.modelData.isActive ? 0 : 1
                    border.color: Qt.darker(root.contentForeground, 1.6)
                  }

                  Text {
                    textFormat: Text.PlainText
                    anchors.verticalCenter: parent.verticalCenter
                    width: Math.min(implicitWidth, parent.width - Style.space(16))
                    elide: Text.ElideRight
                    text: zoneRow.modelData.name
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                  }
                }

                // Right cluster: time, offset, and day marker each in a
                // fixed-width column so they line up down the list
                // regardless of how the city names to their left vary in
                // length. The day marker sits in an Item with a fixed size
                // because a Row skips children of zero width or height, and
                // an empty Text has zero height: a bare Text here would drop
                // out of rows with no marker and shift their time and offset
                // columns right of the rows that have one.
                Row {
                  id: valueColumns
                  anchors.right: removeArea.left
                  anchors.rightMargin: Style.space(10)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: Style.space(8)

                  Text {
                    textFormat: Text.PlainText
                    anchors.verticalCenter: parent.verticalCenter
                    width: Style.space(46)
                    horizontalAlignment: Text.AlignRight
                    text: zoneRow.modelData.timeText
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                  }

                  Text {
                    textFormat: Text.PlainText
                    anchors.verticalCenter: parent.verticalCenter
                    width: Style.space(38)
                    horizontalAlignment: Text.AlignRight
                    text: zoneRow.modelData.offsetText
                    color: Qt.darker(root.contentForeground, 1.4)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                  }

                  Item {
                    anchors.verticalCenter: parent.verticalCenter
                    width: Style.space(26)
                    height: Style.font.bodySmall

                    Text {
                      textFormat: Text.PlainText
                      anchors.left: parent.left
                      anchors.verticalCenter: parent.verticalCenter
                      text: zoneRow.modelData.dayMarker
                      color: Qt.darker(root.contentForeground, 1.5)
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.bodySmall
                    }
                  }
                }

                Item {
                  id: removeArea
                  width: Style.space(22)
                  height: Style.space(22)
                  anchors.right: parent.right
                  anchors.rightMargin: Style.space(6)
                  anchors.verticalCenter: parent.verticalCenter

                  Text {
                    textFormat: Text.PlainText
                    anchors.centerIn: parent
                    visible: rowMouse.containsMouse || removeMouse.containsMouse
                    text: "✕"
                    color: removeMouse.containsMouse ? root.contentUrgent : Qt.darker(root.contentForeground, 1.4)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.bodySmall
                  }

                  MouseArea {
                    id: removeMouse
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onClicked: root.removeZoneAt(zoneRow.index)
                  }

                  PanelToolTip {
                    visible: removeMouse.containsMouse
                    text: "Remove zone"
                    fontFamily: root.contentFontFamily
                  }
                }
              }
            }
          }

          // ---- Add: search field, debounced geocoding, and its
          //      suggestions or an inline error underneath.
          Column {
            width: parent.width
            spacing: Style.space(6)

            TextField {
              id: searchField
              width: parent.width
              placeholderText: "Add a time zone…"
              foreground: root.contentForeground
              font.family: root.contentFontFamily

              onTextChanged: searchDebounce.restart()

              Keys.onPressed: function(event) {
                if (event.key === Qt.Key_Escape) {
                  if (searchField.text.length > 0) {
                    searchField.text = ""
                    root.suggestions = []
                    root.searchError = ""
                  } else {
                    root.close()
                  }
                  event.accepted = true
                } else if (event.key === Qt.Key_Down) {
                  if (root.suggestionIndex < root.suggestions.length - 1) root.suggestionIndex++
                  event.accepted = true
                } else if (event.key === Qt.Key_Up) {
                  if (root.suggestionIndex > 0) root.suggestionIndex--
                  event.accepted = true
                } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
                  if (root.suggestions.length > 0) root.pickSuggestion(root.suggestions[root.suggestionIndex])
                  event.accepted = true
                }
              }
            }

            Text {
              visible: root.searchError !== ""
              text: root.searchError
              color: Qt.darker(root.contentForeground, 1.4)
              font.family: root.contentFontFamily
              font.pixelSize: Style.font.bodySmall
              font.italic: true
            }

            Column {
              visible: root.suggestions.length > 0
              width: parent.width
              spacing: 0

              Repeater {
                model: root.suggestions

                Rectangle {
                  required property var modelData
                  required property int index
                  width: parent.width
                  height: suggestionText.implicitHeight + Style.space(12)
                  radius: Style.cornerRadius
                  color: index === root.suggestionIndex ? Style.hoverFillFor(root.contentForeground, Color.accent) : "transparent"

                  Text {
                    id: suggestionText
                    textFormat: Text.PlainText
                    anchors.left: parent.left
                    anchors.leftMargin: Style.space(14)
                    anchors.right: parent.right
                    anchors.rightMargin: Style.space(14)
                    anchors.verticalCenter: parent.verticalCenter
                    elide: Text.ElideRight
                    text: modelData.display
                    color: index === root.suggestionIndex ? Style.hoverStateColor(root.contentForeground, Color.accent) : root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                  }

                  MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onPositionChanged: root.suggestionIndex = index
                    onClicked: root.pickSuggestion(modelData)
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

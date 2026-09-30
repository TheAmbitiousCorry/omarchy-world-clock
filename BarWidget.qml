import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "Model.js" as Model

// Bar label for the saved time zones, and the host for the switch-and-add
// popup. A horizontal bar with saved zones shows every one of them as
// "LABEL time", joined inline; a vertical bar, or no saved zones at all,
// falls back to a single globe glyph so the popup stays reachable either
// way. All the time math and the settings themselves live in Panel.qml,
// which runs whether or not the popup is open.
BarWidget {
  id: root
  moduleName: "kr34t1v.world-clock"

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  readonly property var zones: panelLoader.item ? panelLoader.item.zones : []
  readonly property string barText: panelLoader.item ? panelLoader.item.barLine() : ""
  readonly property bool showLabel: !root.vertical && root.zones.length > 0

  // Shape contract for shell.summon/hide/toggle routing (Bar.findPanelWidget
  // requires open/close/opened on the bar-widget root).
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    if (panelLoader.item) panelLoader.item.toggle()
  }

  // Forwarded so this widget can stand in for the panel as the bar's popout
  // identity: Bar.requestPopout prefers closeForPopoutSwitch over close, and
  // KeyboardPanel reads popoutSwitchClosing back off its owner.
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  IpcHandler {
    target: "kr34t1v.world-clock"

    function open(): void { root.open() }
    function close(): void { root.close() }
    function toggle(): void { root.togglePanel() }
    // Beyond the required open/close/toggle: a scriptable way to step the
    // active zone without a pointer, handy for testing and for anyone who
    // wants to bind it to a key.
    function next(): void { if (panelLoader.item) panelLoader.item.stepActive(1) }
    function previous(): void { if (panelLoader.item) panelLoader.item.stepActive(-1) }
    // Keyboard path into the add-zone search field (weather's `edit` is the
    // same idiom: open first, then hand focus to the field), so the add
    // flow is reachable without a mouse click on the field.
    function add(): void {
      root.open()
      if (panelLoader.item && typeof panelLoader.item.focusSearch === "function") panelLoader.item.focusSearch()
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: root.showLabel ? root.barText : ""
    labelVisible: root.showLabel
    hasVisualContent: true
    fixedWidth: root.showLabel ? -1 : (root.vertical ? -1 : Style.bar.statusSlot)
    fixedHeight: root.vertical ? Style.bar.iconSlot : -1
    horizontalMargin: 8.75
    verticalPadding: 8.75

    onPressed: function(b) {
      if (b === Qt.LeftButton) root.togglePanel()
    }

    OpticalGlyph {
      visible: !root.showLabel
      anchors.centerIn: parent
      text: ""
      fontFamily: button.fontFamily
      fontSize: Style.bar.iconFont
      color: button.foreground
    }
  }
}

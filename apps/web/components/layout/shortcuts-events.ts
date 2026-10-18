/** The keyboard shortcuts sheet (components/layout/desktop-shortcuts.tsx) opens on this. */
export const openShortcutsEvent = "saphra:open-shortcuts";

/** Opens the keyboard shortcuts sheet. The sidebar's foot calls this. */
export function openShortcutsSheet() {
  window.dispatchEvent(new Event(openShortcutsEvent));
}

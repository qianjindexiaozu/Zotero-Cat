import { config } from "../../package.json";
import { getString } from "../utils/locale";

const PREFS_PANE_ID = `${config.addonRef}-preferences`;

export function registerPrefsPane() {
  Zotero.PreferencePanes.register({
    pluginID: addon.data.config.addonID,
    id: PREFS_PANE_ID,
    src: rootURI + "content/preferences.xhtml",
    label: getString("prefs-title"),
    image: `chrome://${addon.data.config.addonRef}/content/icons/icon-16.png`,
  });
}

export function openAgentPreferences() {
  const opener = (
    Zotero.Utilities.Internal as unknown as {
      openPreferences?: (paneID: string, options?: object) => Window | null;
    }
  ).openPreferences;
  if (typeof opener === "function") {
    opener(PREFS_PANE_ID);
  }
}

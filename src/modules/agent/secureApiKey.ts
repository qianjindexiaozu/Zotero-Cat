import { config } from "../../../package.json";
import { clearPref } from "../../utils/prefs";

const LOGIN_ORIGIN = `chrome://${config.addonRef}`;
const LOGIN_REALM = `${config.addonName} API Key`;
const LEGACY_PREF_KEY = "openaiApiKey";

type LoginInfoConstructor = new (
  origin: string,
  formActionOrigin: string,
  httpRealm: string,
  username: string,
  password: string,
  usernameField: string,
  passwordField: string,
) => nsILoginInfo;

const LoginInfo = (Components as any).Constructor(
  "@mozilla.org/login-manager/loginInfo;1",
  "nsILoginInfo",
  "init",
) as LoginInfoConstructor;

export function getProviderApiKey(provider: string) {
  return readStoredProviderApiKey(provider) || readLegacyApiKey();
}

export async function setProviderApiKey(provider: string, apiKey: string) {
  const normalizedProvider = normalizeProvider(provider);
  const nextApiKey = apiKey.trim();
  const existing = findProviderLogins(normalizedProvider);
  for (const login of existing) {
    Services.logins.removeLogin(login);
  }
  if (!nextApiKey) {
    return;
  }
  const loginInfo = new LoginInfo(
    LOGIN_ORIGIN,
    "",
    LOGIN_REALM,
    normalizedProvider,
    nextApiKey,
    "",
    "",
  );
  await Services.logins.addLoginAsync(loginInfo);
}

export async function migrateLegacyApiKey(provider: string) {
  const legacyApiKey = readLegacyApiKey();
  if (!legacyApiKey) {
    return;
  }
  const storedApiKey = readStoredProviderApiKey(provider);
  if (!storedApiKey) {
    await setProviderApiKey(provider, legacyApiKey);
  }
  clearPref(LEGACY_PREF_KEY);
}

function readStoredProviderApiKey(provider: string) {
  const login = findProviderLogins(provider)[0];
  if (!login) {
    return "";
  }
  return login.password?.trim() || "";
}

function findProviderLogins(provider: string) {
  const normalizedProvider = normalizeProvider(provider);
  try {
    const logins = Services.logins.findLogins(LOGIN_ORIGIN, "", LOGIN_REALM);
    return logins.filter((login) => login.username === normalizedProvider);
  } catch (_error) {
    return [];
  }
}

function normalizeProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();
  return normalized || "openai-compatible";
}

function readLegacyApiKey() {
  const value = Zotero.Prefs.get(
    `${config.prefsPrefix}.${LEGACY_PREF_KEY}`,
    true,
  );
  if (typeof value !== "string") {
    return "";
  }
  return value.trim();
}

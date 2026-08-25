/**
 * Update check against the GitHub releases of this repo. Deliberately a plain
 * "there's a newer version, here's the release page" notice rather than the
 * Tauri updater — no signing keys or update manifest to maintain.
 */

const REPO = "HoshangDEV/broutils";
const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`;
export const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

export interface AvailableUpdate {
  /** Version of the newest release, without the leading "v". */
  version: string;
  /** Release page to open in the browser. */
  url: string;
}

/** Numeric semver compare; returns >0 when `a` is newer than `b`. */
function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Resolves to the newer release, or `null` when up to date, offline, or the
 * request failed — a failed check is never surfaced to the user.
 */
export async function checkForUpdate(
  currentVersion: string,
): Promise<AvailableUpdate | null> {
  if (!currentVersion) return null;
  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    const data: { tag_name?: string; html_url?: string; draft?: boolean } =
      await res.json();
    if (!data.tag_name || data.draft) return null;

    const latest = data.tag_name.replace(/^v/, "");
    if (compareVersions(latest, currentVersion) <= 0) return null;

    return { version: latest, url: data.html_url ?? RELEASES_PAGE };
  } catch {
    return null;
  }
}

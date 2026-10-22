// Detects new revisions of downloaded models on Hugging Face. The first check after a download
// records the current revision as the baseline; later checks compare against it.

const BASELINE_KEY = "lexi-model-revisions";
const LAST_CHECK_KEY = "lexi-model-check-at";
const CHECK_EVERY_MS = 24 * 3600 * 1000;

/** WebLLM prebuilt ids live under the mlc-ai org; Transformers.js ids are already repo paths. */
export const repoOf = (modelId: string) => (modelId.includes("/") ? modelId : `mlc-ai/${modelId}`);

const readJson = <T>(key: string, fallback: T): T => {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "") as T;
  } catch {
    return fallback;
  }
};

export async function remoteRevision(modelId: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  const res = await fetcher(`https://huggingface.co/api/models/${repoOf(modelId)}`);
  if (!res.ok) return null;
  const json = (await res.json()) as { sha?: string };
  return json.sha ?? null;
}

/** Pure decision used by the checker: which cached models have a revision newer than the baseline. */
export function diffRevisions(baseline: Record<string, string>, remote: Record<string, string | null>) {
  const nextBaseline = { ...baseline };
  const outdated: string[] = [];
  for (const [id, sha] of Object.entries(remote)) {
    if (!sha) continue;
    if (!baseline[id]) nextBaseline[id] = sha;
    else if (baseline[id] !== sha) outdated.push(id);
  }
  return { outdated, nextBaseline };
}

export async function checkForModelUpdates(cachedIds: string[], force = false): Promise<string[]> {
  if (!cachedIds.length || !navigator.onLine) return [];
  const last = Number(localStorage.getItem(LAST_CHECK_KEY) ?? 0);
  if (!force && Date.now() - last < CHECK_EVERY_MS) return [];
  const remote = Object.fromEntries(
    await Promise.all(cachedIds.map(async (id) => [id, await remoteRevision(id).catch(() => null)] as const)),
  );
  const { outdated, nextBaseline } = diffRevisions(readJson(BASELINE_KEY, {}), remote);
  localStorage.setItem(BASELINE_KEY, JSON.stringify(nextBaseline));
  localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  return outdated;
}

/** Called after a successful re-download so the new revision becomes the baseline. */
export async function markUpdated(modelId: string) {
  const sha = await remoteRevision(modelId).catch(() => null);
  if (!sha) return;
  const baseline = readJson<Record<string, string>>(BASELINE_KEY, {});
  localStorage.setItem(BASELINE_KEY, JSON.stringify({ ...baseline, [modelId]: sha }));
}

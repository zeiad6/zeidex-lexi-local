import { useCallback, useEffect, useState } from "react";
import { Copy, Share2, ShieldAlert, Wifi } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useI18n } from "@/i18n";
import { notify } from "@/lib/notify";
import { android } from "@/lib/native";
import { BRAND } from "@/brand";

/** Shape returned by server/server.mjs GET /api/lan. */
interface LanInfo {
  enabled: boolean;
  https: boolean;
  urls: { url: string; iface: string; kind: "lan" | "vpn" | "virtual" }[];
  firewall: { tool: string; active: boolean | null; command: string | null; note: string };
  docker: boolean;
}

function Qr({ text }: { text: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    import("qrcode")
      .then((QRCode) => QRCode.toDataURL(text, { margin: 1, width: 180 }))
      .then(setSrc, () => setSrc(""));
  }, [text]);
  return src ? <img src={src} alt={text} className="size-36 rounded-lg bg-white p-1" /> : null;
}

export function ShareDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [info, setInfo] = useState<LanInfo | null | "static">(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (android) return setInfo("static");
    try {
      const res = await fetch("./api/lan", { cache: "no-store" });
      setInfo(res.ok && res.headers.get("content-type")?.includes("json") ? await res.json() : "static");
    } catch {
      setInfo("static");
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const toggle = async (enable: boolean) => {
    setBusy(true);
    try {
      const res = await fetch("./api/share", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enable }) });
      if (!res.ok) throw new Error(await res.text());
      setInfo(await res.json());
    } catch (e) {
      notify({ title: t.error, body: String(e), tone: "warning" });
    } finally {
      setBusy(false);
    }
  };

  const copy = (url: string) => navigator.clipboard.writeText(url).then(() => notify({ title: t.copied, body: url, tone: "success" }));
  const here = location.href.split("#")[0];

  return (
    <Modal open={open} onClose={onClose} title={t.shareTitle} closeLabel={t.close}>
      {info === null ? (
        <p className="text-sm text-muted-foreground">…</p>
      ) : info === "static" && android ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t.shareAppDesc}</p>
          <Button variant="accent" onClick={() => android!.shareApp()}>
            <Share2 /> {t.shareApp}
          </Button>
          <Button variant="outline" onClick={() => android!.share(`${BRAND.app} — ${BRAND.website}/programs`, BRAND.app)}>
            <Copy /> {t.shareLink}
          </Button>
        </div>
      ) : info === "static" ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t.shareStatic}</p>
          <div className="flex flex-col items-center gap-2">
            <Qr text={here} />
            <code className="break-all text-xs" dir="ltr">
              {here}
            </code>
          </div>
          <div className="flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={() => copy(here)}>
              <Copy /> {t.copyLink}
            </Button>
            {"share" in navigator && (
              <Button variant="outline" size="sm" onClick={() => navigator.share({ title: document.title, url: here }).catch(() => undefined)}>
                <Share2 /> {t.shareNative}
              </Button>
            )}
          </div>
        </div>
      ) : !info.enabled ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{t.shareLanOff}</p>
          <Button variant="accent" onClick={() => toggle(true)} disabled={busy}>
            <Wifi /> {t.enableLan}
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm">{t.lanUrls}</p>
          <ul className="space-y-3">
            {info.urls.map((u, i) => (
              <li key={u.url} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                {i === 0 && <Qr text={u.url} />}
                <div className="min-w-0 flex-1 space-y-1">
                  <code className="block break-all text-sm font-semibold" dir="ltr">
                    {u.url}
                  </code>
                  <span className="flex gap-1">
                    <Badge>{u.iface}</Badge>
                    {u.kind !== "lan" && <Badge variant="accent">{u.kind}</Badge>}
                  </span>
                </div>
                <Button variant="outline" size="sm" onClick={() => copy(u.url)}>
                  <Copy /> {t.copyLink}
                </Button>
              </li>
            ))}
          </ul>
          <p className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">{info.https ? t.httpsNote : t.insecureNote}</p>
          <div className="rounded-lg border border-border p-3 text-xs">
            <p className="mb-1 flex items-center gap-1.5 font-semibold">
              <ShieldAlert className="size-4 text-accent" aria-hidden /> {t.firewall}: <span dir="ltr">{info.firewall.tool}</span>
            </p>
            <p className="text-muted-foreground" dir="auto">
              {info.firewall.command ? info.firewall.note : t.firewallOk}
            </p>
            {info.firewall.command && (
              <code className="mt-2 block break-all rounded bg-muted p-2" dir="ltr">
                {info.firewall.command}
              </code>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => toggle(false)} disabled={busy}>
            {t.disableLan}
          </Button>
        </div>
      )}
    </Modal>
  );
}

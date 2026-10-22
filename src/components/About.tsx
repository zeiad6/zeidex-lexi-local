import { ExternalLink, FolderGit2, Globe, Heart } from "lucide-react";
import { BRAND } from "@/brand";
import { useI18n } from "@/i18n";
import { APP_VERSION } from "@/lib/appUpdate";
import { platform } from "@/lib/native";

export function About({ onDonate }: { onDonate?: () => void }) {
  const { t } = useI18n();
  const link = "inline-flex items-center gap-1.5 text-sm text-accent underline-offset-4 hover:underline";
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <img src="./icon.svg" alt="" className="size-12" />
        <div>
          <p className="font-display text-lg font-semibold">{BRAND.app}</p>
          <p className="text-xs text-muted-foreground" dir="ltr">
            {t.version} {APP_VERSION} · {platform}
          </p>
          <p className="text-sm text-muted-foreground">
            {t.developedBy}{" "}
            <a className="font-semibold text-foreground underline-offset-4 hover:underline" href={BRAND.developerUrl} target="_blank" rel="noreferrer">
              {BRAND.developer}
            </a>
          </p>
        </div>
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-2">
        <li>
          <a className={link} href={BRAND.developerUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" /> ZeidexLink
          </a>
        </li>
        <li>
          <a className={link} href={BRAND.website} target="_blank" rel="noreferrer">
            <Globe className="size-4" /> {t.website}
          </a>
        </li>
        <li>
          <a className={link} href={BRAND.repo} target="_blank" rel="noreferrer">
            <FolderGit2 className="size-4" /> {t.sourceCode}
          </a>
        </li>
        {onDonate && (
          <li>
            <button type="button" className={link} onClick={onDonate}>
              <Heart className="size-4" /> {t.donate}
            </button>
          </li>
        )}
      </ul>
      <p className="rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground">
        © {new Date().getFullYear()} {BRAND.developer}. {t.licenseNote}
      </p>
    </div>
  );
}

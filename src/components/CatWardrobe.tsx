import { useEffect } from "react";
import { catSrc, OUTFITS, type OutfitId } from "../mascot/mascot";
import { useCatManifest } from "../mascot/useCatManifest";

export type OutfitSetting = "auto" | OutfitId;

// Right-click popover: "Auto" + one thumbnail per outfit. Hover previews, click saves.
export function CatWardrobe(props: {
  value: OutfitSetting;
  t: (key: string) => string;
  onPreview: (outfit: OutfitId | null) => void;
  onPick: (value: OutfitSetting) => void;
  onClose: () => void;
}) {
  const { value, t, onPreview, onPick, onClose } = props;
  const manifest = useCatManifest();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const options: OutfitSetting[] = ["auto", ...OUTFITS];
  return (
    <div className="cat-wardrobe" role="menu" onMouseLeave={() => { onPreview(null); onClose(); }} onClick={(e) => e.stopPropagation()}>
      {options.map((o) => {
        const label = t(`cat.outfit.${o}`);
        return (
          <button
            key={o}
            type="button"
            role="menuitemradio"
            aria-checked={value === o}
            aria-label={label}
            title={label}
            className={`cat-wardrobe-item${value === o ? " active" : ""}`}
            autoFocus={value === o}
            onMouseEnter={() => o !== "auto" && onPreview(o)}
            onFocus={() => o !== "auto" && onPreview(o)}
            onClick={() => onPick(o)}
          >
            {o === "auto" ? <span>{label}</span> : <img src={catSrc(manifest, o, "idle")} alt="" draggable={false} />}
          </button>
        );
      })}
    </div>
  );
}

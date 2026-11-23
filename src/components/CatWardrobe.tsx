import { useEffect, useMemo, useState } from "react";
import { CAT_COLORS, OUTFITS, resolveOutfit, type CatColor, type OutfitId } from "../mascot/mascot";
import { PALETTES } from "../mascot/catEngine";
import { CatMascot } from "./CatMascot";

export type OutfitSetting = "auto" | OutfitId;

const swatch = (c: CatColor) => {
  const p = PALETTES[c];
  const stripes = p.stripes ? `repeating-linear-gradient(100deg, transparent 0 3px, ${p.stripes} 3px 4.5px), ` : "";
  return `${stripes}linear-gradient(160deg, ${p.top}, ${p.bottom})`;
};

// Right-click popover: a colour row, then "Auto" + one live cat thumbnail per outfit. Hover previews, click saves.
export function CatWardrobe(props: {
  value: OutfitSetting;
  color: CatColor;
  t: (key: string) => string;
  onPreview: (outfit: OutfitId | null) => void;
  onPick: (value: OutfitSetting) => void;
  onPreviewColor: (color: CatColor | null) => void;
  onPickColor: (color: CatColor) => void;
  onClose: () => void;
}) {
  const { value, color, t, onPreview, onPick, onPreviewColor, onPickColor, onClose } = props;
  const [hoverColor, setHoverColor] = useState<CatColor | null>(null);
  const thumbColor = hoverColor ?? color;
  const autoNow = useMemo(() => resolveOutfit("auto", new Date()), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const previewColor = (c: CatColor | null) => {
    setHoverColor(c);
    onPreviewColor(c);
  };

  const options: OutfitSetting[] = ["auto", ...OUTFITS];
  return (
    <div
      className="cat-wardrobe"
      role="menu"
      onMouseLeave={() => { onPreview(null); previewColor(null); onClose(); }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="cat-wardrobe-colors" role="group" aria-label={t("cat.color.label")}>
        {CAT_COLORS.map((c) => {
          const label = t(`cat.color.${c}`);
          return (
            <button
              key={c}
              type="button"
              role="menuitemradio"
              aria-checked={color === c}
              aria-label={label}
              title={label}
              className={`cat-wardrobe-swatch${color === c ? " active" : ""}`}
              style={{ background: swatch(c) }}
              onMouseEnter={() => previewColor(c)}
              onFocus={() => previewColor(c)}
              onMouseLeave={() => previewColor(null)}
              onBlur={() => previewColor(null)}
              onClick={() => onPickColor(c)}
            />
          );
        })}
      </div>
      <div className="cat-wardrobe-outfits">
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
              <CatMascot pose="idle" outfit={o === "auto" ? autoNow : o} color={thumbColor} size={28} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

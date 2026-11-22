import { useEffect, useState } from "react";
import type { CatManifest } from "./mascot";

const EMPTY: CatManifest = { outfits: {} };
let cached: CatManifest | null = null;
let pending: Promise<CatManifest> | null = null;

function load(): Promise<CatManifest> {
  pending ??= fetch("/cat/manifest.json")
    .then((r) => (r.ok ? (r.json() as Promise<CatManifest>) : EMPTY))
    .catch(() => EMPTY)
    .then((m) => (cached = m?.outfits ? m : EMPTY));
  return pending;
}

export function useCatManifest(): CatManifest {
  const [m, setM] = useState<CatManifest>(cached ?? EMPTY);
  useEffect(() => {
    let live = true;
    load().then((x) => live && setM(x));
    return () => {
      live = false;
    };
  }, []);
  return m;
}

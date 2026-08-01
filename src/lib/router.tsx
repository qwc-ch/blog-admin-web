import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "../lib/utils";

export type View = "list" | "editor" | "images" | "config";

export interface Route {
  view: View;
  slug?: string;
}

/** 解析 hash 路由: #/ -> list, #/editor -> editor, #/editor/:slug -> editor+slug, #/images, #/config */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, "").split("/");
  const seg = parts[0];
  if (seg === "editor" || seg === "images" || seg === "config") {
    if (seg === "editor" && parts[1]) {
      try {
        return { view: seg, slug: decodeURIComponent(parts[1]) };
      } catch {
        return { view: seg, slug: parts[1] };
      }
    }
    return { view: seg };
  }
  return { view: "list" };
}

export function toHash(route: Route): string {
  if (route.view === "editor") {
    return route.slug
      ? `#/editor/${encodeURIComponent(route.slug)}`
      : "#/editor";
  }
  return route.view === "list" ? "#/" : `#/${route.view}`;
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

/* ---------- 一键回顶 ---------- */

export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 300);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="回到顶部"
      className={cn(
        "fixed bottom-6 right-6 z-50 flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg border border-border bg-card text-muted-foreground",
        "transition-all duration-75 hover:bg-foreground hover:text-background hover:border-foreground",
        visible
          ? "translate-y-0 opacity-100"
          : "pointer-events-none translate-y-2 opacity-0",
      )}
    >
      <ArrowUp className="h-4 w-4" />
    </button>
  );
}

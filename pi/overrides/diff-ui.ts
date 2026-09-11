import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { isViewportTUI, type Component, type KeybindingsManager, type TUI } from "@earendil-works/pi-tui";

type ReviewFactory<T> = (
  tui: TUI, theme: Theme, keys: KeybindingsManager, done: (result: T) => void,
) => Component & { dispose?(): void };

const backgrounds = new WeakMap<TUI, { release(): void; acquire(): void }>();

function hideBackground(tui: TUI): () => void {
  const existing = backgrounds.get(tui);
  if (existing) {
    existing.acquire();
    return existing.release;
  }
  const descriptor = Object.getOwnPropertyDescriptor(tui, "render");
  const blank = () => Array.from({ length: Math.max(0, tui.terminal.rows) }, () => "");
  let users = 1;
  Object.defineProperty(tui, "render", { configurable: true, writable: true, value: blank });
  const state = {
    acquire() { users++; },
    release() {
      if (--users > 0) return;
      backgrounds.delete(tui);
      if (tui.render !== blank) return;
      if (descriptor) Object.defineProperty(tui, "render", descriptor);
      else delete (tui as Partial<TUI>).render;
      tui.requestRender(true);
    },
  };
  backgrounds.set(tui, state);
  tui.requestRender(true);
  return state.release;
}

export async function openReview<T>(ctx: ExtensionContext, factory: ReviewFactory<T>): Promise<T> {
  let release: (() => void) | undefined;
  try {
    return await ctx.ui.custom<T>((tui, theme, keys, done) => {
      const component = factory(tui, theme, keys, done);
      // Main-screen overlays retain offscreen history, whose updates force clears.
      // Only hide its rendering. Agent state and the live component tree keep updating.
      if (!isViewportTUI(tui)) {
        const descriptor = Object.getOwnPropertyDescriptor(tui, "render");
        if (tui.constructor.name === "TuiMainScreen" && typeof tui.render === "function" &&
            (!descriptor || descriptor.configurable) && Object.isExtensible(tui)) {
          release = hideBackground(tui);
        } else {
          ctx.ui.notify("Diff background isolation is unavailable in this Pi renderer; streaming may still repaint the review.", "warning");
        }
      }
      return component;
    }, {
      overlay: true,
      overlayOptions: { anchor: "top-left", width: "100%", maxHeight: "100%" },
    });
  } finally {
    release?.();
  }
}

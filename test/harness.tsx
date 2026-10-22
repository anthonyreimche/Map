import * as React from "react";
import { create } from "zustand";
import type {
  ButtonProps,
  CatalogPhoto,
  CatalogState,
  FieldProps,
  GridFilterContribution,
  GridMenuItemContribution,
  KeyActionContribution,
  ModuleContribution,
  NumberInputProps,
  PanelContribution,
  RowProps,
  SafelightAPI,
  SectionProps,
  SettingsContribution,
  SlotContribution,
  StackProps,
  StoreApi,
  StylesheetContribution,
  TextInputProps,
  ThemeStoreState,
  ThumbnailProps,
  ToggleProps,
  UIState,
  UiKit,
} from "../src/safelight";
import { act } from "@testing-library/react";
import { createFakeVariables, type FakeVariables } from "./fake-variables";

export function photo(over: Partial<CatalogPhoto> & { id: string }): CatalogPhoto {
  return {
    filename: `${over.id}.NEF`,
    thumbnailBlob: null,
    thumbnailUrl: null,
    width: 6000,
    height: 4000,
    rating: 0,
    colorLabel: "none",
    flag: "none",
    keywords: [],
    dateCreated: 0,
    exif: {},
    ...over,
  };
}

/** A photo at a location; `t` is the EXIF capture string. */
export function located(id: string, lat: number, lon: number, t?: string): CatalogPhoto {
  return photo({ id, exif: { gpsLatitude: lat, gpsLongitude: lon, ...(t ? { dateTimeOriginal: t } : {}) } });
}

export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

const Button = ({ children, onClick, disabled, title, "aria-label": ariaLabel, active, type = "button" }: ButtonProps) => (
  <button type={type} onClick={onClick} disabled={disabled} title={title} aria-label={ariaLabel} aria-pressed={active}>
    {children}
  </button>
);
const Toggle = ({ checked, onChange, label, ariaLabel }: ToggleProps) => (
  <label>
    <input type="checkbox" checked={checked} aria-label={ariaLabel} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);
const NumberInput = ({ value, onChange, "aria-label": ariaLabel }: NumberInputProps) => (
  <input type="number" value={value} aria-label={ariaLabel} onChange={(e) => onChange(Number(e.target.value))} />
);
const TextInput = ({ value, onChange, placeholder, "aria-label": ariaLabel, autoFocus }: TextInputProps) => (
  <input value={value} placeholder={placeholder} aria-label={ariaLabel} autoFocus={autoFocus} onChange={(e) => onChange(e.target.value)} />
);
const Field = ({ label, children }: FieldProps) => (
  <div>
    {label != null && <span>{label}</span>}
    {children}
  </div>
);
const Section = ({ title, right, children }: SectionProps) => (
  <section>
    <h3>{title}</h3>
    {right}
    {children}
  </section>
);
const Row = ({ children }: RowProps) => <div>{children}</div>;
const Stack = ({ children }: StackProps) => <div>{children}</div>;

const ui: UiKit = {
  Button,
  Toggle,
  NumberInput,
  TextInput,
  Field,
  Section,
  Row,
  Stack,
  tokens: {
    surface0: "#525252",
    surface1: "#5e5e5e",
    surface2: "#666666",
    surface3: "#707070",
    surface4: "#7a7a7a",
    border: "#3b3b3b",
    textPrimary: "#f0f0f0",
    textSecondary: "#c4c4c4",
    textMuted: "#9c9c9c",
    accent: "#4a90d9",
    fontMono: "monospace",
  },
};

const Thumbnail = ({ photo: p, selected, active, onClick, onDoubleClick, onContextMenu, onDragStart }: ThumbnailProps) => (
  <div
    data-photo-id={p.id}
    data-selected={selected}
    data-active={active}
    draggable={!!onDragStart}
    onClick={(e) => onClick(p.id, e)}
    onDoubleClick={onDoubleClick ? () => onDoubleClick(p.id) : undefined}
    onContextMenu={onContextMenu ? (e) => onContextMenu(p.id, e) : undefined}
    onDragStart={onDragStart ? (e) => onDragStart(p.id, e) : undefined}
  >
    {p.filename}
  </div>
);

export interface Harness {
  api: SafelightAPI;
  modules: ModuleContribution[];
  panels: PanelContribution[];
  keybindings: KeyActionContribution[];
  gridFilters: Map<string, GridFilterContribution>;
  /** Every registerGridFilter call's id, in order (re-registrations included). */
  filterRegistrations: string[];
  menuItems: GridMenuItemContribution[];
  settings: SettingsContribution[];
  stylesheets: StylesheetContribution[];
  slots: SlotContribution[];
  navigations: string[];
  requested: string[];
  relocated: CatalogPhoto[][];
  values: Map<string, unknown>;
  // The slice's own StoreApi<T>, not zustand's: `typeof create<T>` resolves to
  // zustand's curried overload here, whose ReturnType is a function, not a store.
  catalog: StoreApi<CatalogState>;
  theme: StoreApi<ThemeStoreState>;
  contextMenus: string[];
  /** Shared by every harness given the same instance, to test two extensions against one set of variables. */
  variables: FakeVariables;
}

export function createHarness(opts: { photos?: CatalogPhoto[]; variables?: FakeVariables; extensionId?: string } = {}): Harness {
  const variables = opts.variables ?? createFakeVariables();
  const h = {
    modules: [] as ModuleContribution[],
    panels: [] as PanelContribution[],
    keybindings: [] as KeyActionContribution[],
    gridFilters: new Map<string, GridFilterContribution>(),
    filterRegistrations: [] as string[],
    menuItems: [] as GridMenuItemContribution[],
    settings: [] as SettingsContribution[],
    stylesheets: [] as StylesheetContribution[],
    slots: [] as SlotContribution[],
    navigations: [] as string[],
    requested: [] as string[],
    relocated: [] as CatalogPhoto[][],
    values: new Map<string, unknown>(),
    contextMenus: [] as string[],
  };
  const listeners = new Set<(key: string, value: unknown) => void>();

  // select, toggleSelect and selectRange follow core's catalog store
  // (src/state/catalog-store.ts), minus its cross-window broadcasts.
  const catalog = create<CatalogState>((set, get) => ({
    photos: opts.photos ?? [],
    selectedIds: new Set<string>(),
    activePhotoId: null,
    select: (id) => set({ selectedIds: new Set([id]), activePhotoId: id }),
    toggleSelect: (id) => {
      const { selectedIds, activePhotoId } = get();
      const next = new Set(selectedIds);
      if (!next.has(id)) {
        next.add(id);
        set({ selectedIds: next, activePhotoId: id });
        return;
      }
      next.delete(id);
      const active = activePhotoId === id ? ([...next].pop() ?? null) : activePhotoId;
      set({ selectedIds: next, activePhotoId: active });
    },
    selectRange: (id, orderedIds) => {
      const { photos, activePhotoId, selectedIds } = get();
      if (!activePhotoId) {
        set({ selectedIds: new Set([id]), activePhotoId: id });
        return;
      }
      const order = orderedIds ?? photos.map((p) => p.id);
      const a = order.indexOf(activePhotoId);
      const b = order.indexOf(id);
      if (a === -1 || b === -1) return;
      const [lo, hi] = a < b ? [a, b] : [b, a];
      set({ selectedIds: new Set([...selectedIds, ...order.slice(lo, hi + 1)]) });
    },
    setActivePhoto: (id) => set({ activePhotoId: id }),
    setRating: async (id, rating) =>
      set((s) => ({ photos: s.photos.map((p) => (p.id === id ? { ...p, rating } : p)) })),
    relocatePhotos: async (updated) => {
      h.relocated.push(updated);
      const byId = new Map(updated.map((p) => [p.id, p] as const));
      set((s) => ({ photos: s.photos.map((p) => byId.get(p.id) ?? p) }));
    },
  }));
  const theme = create<ThemeStoreState>(() => ({ activeId: "core.neutral" }));
  const uiStore = create<UIState>(() => ({ activeModule: "map", detached: new Set<string>() }));

  const api: SafelightAPI = {
    version: 1,
    extensionId: opts.extensionId ?? "map",
    react: React,
    registerModule: (c) => void h.modules.push(c),
    registerPanel: (c) => void h.panels.push(c),
    registerKeybinding: (c) => void h.keybindings.push(c),
    registerGridFilter: (c) => {
      h.gridFilters.set(c.id, c);
      h.filterRegistrations.push(c.id);
    },
    registerGridMenuItem: (c) => void h.menuItems.push(c),
    registerSettings: (c) => void h.settings.push(c),
    registerStylesheet: (c) => void h.stylesheets.push(c),
    registerSlot: (c) => void h.slots.push(c),
    settings: {
      get: <T,>(key: string, fallback: T): T => (h.values.has(key) ? (h.values.get(key) as T) : fallback),
      set: (key, value) => {
        h.values.set(key, value);
        for (const l of listeners) l(key, value);
      },
      onChange: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    },
    ui,
    components: { Thumbnail },
    stores: { create, useCatalogStore: catalog, useUIStore: uiStore, useThemeStore: theme },
    navigation: { goTo: (m) => void h.navigations.push(m) },
    catalog: {
      useVisiblePhotos: (options) => {
        const photos = catalog((s) => s.photos);
        const skip = new Set(options?.without ?? []);
        const filters = [...h.gridFilters.values()].filter((f) => !skip.has(f.id));
        return photos.filter((p) => filters.every((f) => f.test(p)));
      },
      usePhotoActions: () => ({
        // Like core's menu, right-clicking a photo outside the selection selects it.
        onContextMenu: (id) => {
          h.contextMenus.push(id);
          if (!catalog.getState().selectedIds.has(id)) catalog.getState().select(id);
        },
        overlays: null,
      }),
      useCullingShortcuts: () => {},
      requestThumbnail: (id) => void h.requested.push(id),
    },
    variables: variables.forExtension(opts.extensionId ?? "map"),
  };
  return {
    ...h,
    api,
    variables,
    catalog: catalog as unknown as StoreApi<CatalogState>,
    theme: theme as unknown as StoreApi<ThemeStoreState>,
  };
}

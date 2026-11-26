import type {
  ComponentType,
  CSSProperties,
  DragEvent as ReactDragEvent,
  JSX,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from "react";

export interface StoreApi<T> {
  (): T;
  <U>(selector: (state: T) => U): U;
  getState(): T;
  setState(partial: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: (state: T, prev: T) => void): () => void;
}

export type StateCreator<T> = (
  set: (partial: Partial<T> | ((s: T) => Partial<T>)) => void,
  get: () => T,
) => T;

export type ColorLabel = "none" | "red" | "yellow" | "green" | "blue" | "purple";
export type FlagStatus = "none" | "pick" | "reject";

export interface ExifData {
  /** "YYYY:MM:DD HH:MM:SS", the camera's wall clock, no zone. */
  dateTimeOriginal?: string;
  cameraModel?: string;
  gpsLatitude?: number;
  gpsLongitude?: number;
  gpsAltitude?: number;
}

export interface CatalogPhoto {
  id: string;
  filename: string;
  thumbnailBlob: Blob | null;
  thumbnailUrl: string | null;
  width: number;
  height: number;
  rating: number;
  colorLabel: ColorLabel;
  flag: FlagStatus;
  keywords: string[];
  dateCreated: number;
  exif: ExifData;
  decodeError?: string;
  copyOf?: string;
  copyName?: string;
}

export interface CatalogState {
  photos: CatalogPhoto[];
  selectedIds: Set<string>;
  activePhotoId: string | null;
  select(id: string): void;
  toggleSelect(id: string): void;
  selectRange(id: string, orderedIds?: string[]): void;
  setActivePhoto(id: string | null, options?: { broadcast?: boolean }): void;
  setRating(id: string, rating: number): Promise<void>;
  /** Persists the records and updates this window's catalogue. Other windows get
   *  a change notice without the records, so they keep their own copies, and
   *  a later save from one of them can write those back over this change. */
  relocatePhotos(updated: CatalogPhoto[]): Promise<void>;
}

export interface UIState {
  activeModule: string;
  detached: Set<string>;
}

export interface ThemeStoreState {
  activeId: string;
}

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
  /** Render in the red danger colour (e.g. Remove). */
  danger?: boolean;
  disabled?: boolean;
}

/** A horizontal divider between groups of items. */
export type ContextMenuEntry = ContextMenuItem | "separator";

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export interface ThumbnailProps {
  photo: CatalogPhoto;
  selected: boolean;
  active: boolean;
  size: number;
  onClick: (id: string, e: ReactMouseEvent) => void;
  onDoubleClick?: (id: string) => void;
  onContextMenu?: (id: string, e: ReactMouseEvent) => void;
  onRatingChange?: (id: string, rating: number) => void;
  onDragStart?: (id: string, e: ReactDragEvent) => void;
}

export interface PhotoActions {
  onContextMenu: (id: string, e: ReactMouseEvent) => void;
  overlays: ReactNode;
}

export interface CullingShortcutOptions {
  sizeSteps?: boolean;
}

export interface LayoutRail {
  side: "left" | "right" | "bottom";
  width?: number;
  height?: number;
  panels: string[];
}

export interface ModuleLayoutDef {
  rails: LayoutRail[];
}

export interface ModuleContribution {
  id: string;
  label: string;
  component: ComponentType;
  order?: number;
  defaultLayout?: ModuleLayoutDef;
  statusBar?: ComponentType;
}

export interface PanelContribution {
  id: string;
  title: string;
  component: ComponentType;
  fill?: boolean;
  allowBottomDock?: boolean;
  defaultDock?: {
    module: string;
    direction: "left" | "right" | "bottom";
    order?: number;
    width?: number;
    height?: number;
  };
}

export interface KeyActionContribution {
  id: string;
  label: string;
  category?: "General" | "Develop" | "Library";
  defaultCombo: string;
  handler: () => void;
}

export interface GridFilterContribution {
  id: string;
  test(photo: CatalogPhoto): boolean;
  /** The photo fields `test` reads, by top-level name; the Library filters
   *  again only when one changes. `[]` for a test that reads none. */
  reads?: readonly (keyof CatalogPhoto)[];
  onClear?(): void;
}

export interface GridMenuItemContribution {
  id: string;
  label: string | ((ids: string[]) => string);
  order?: number;
  danger?: boolean;
  enabled?: (ids: string[]) => boolean;
  onClick: (ids: string[]) => void;
}

export type SettingsField =
  | { key: string; label: string; hint?: string; type: "boolean"; default: boolean }
  | {
      key: string;
      label: string;
      hint?: string;
      type: "number";
      default: number;
      min?: number;
      max?: number;
      step?: number;
    };

export interface SettingsContribution {
  title?: string;
  fields: SettingsField[];
  keywords?: string[];
}

export interface StylesheetContribution {
  id: string;
  css: string;
}

/** Named regions of core UI an extension may render into. */
export type SlotName = "library-toolbar" | "library-subbar" | "develop-toolbar" | "develop-canvas-overlay" | "develop-detail";

export interface SlotContribution {
  id: string;
  slot: SlotName;
  component: ComponentType;
  order?: number;
}

export interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  /** Defaults to "button", so a Button in a form never submits it by accident. */
  type?: "button" | "submit";
  active?: boolean;
  full?: boolean;
  disabled?: boolean;
  title?: string;
  "aria-label"?: string;
  style?: CSSProperties;
  onClick?(): void;
  children?: ReactNode;
}

export interface ToggleProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label?: ReactNode;
  ariaLabel?: string;
}

export interface NumberInputProps {
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  width?: string;
  "aria-label"?: string;
}

export interface TextInputProps {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  "aria-label"?: string;
  autoFocus?: boolean;
  style?: CSSProperties;
}

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}

export interface SectionProps {
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}

export interface RowProps {
  children?: ReactNode;
  gap?: number;
  align?: CSSProperties["alignItems"];
  justify?: CSSProperties["justifyContent"];
  wrap?: boolean;
  style?: CSSProperties;
}

export interface StackProps {
  children?: ReactNode;
  gap?: number;
  style?: CSSProperties;
}

export interface UiKit {
  Button: ComponentType<ButtonProps>;
  Toggle: ComponentType<ToggleProps>;
  NumberInput: ComponentType<NumberInputProps>;
  TextInput: ComponentType<TextInputProps>;
  Field: ComponentType<FieldProps>;
  Section: ComponentType<SectionProps>;
  Row: ComponentType<RowProps>;
  Stack: ComponentType<StackProps>;
  tokens: {
    surface0: string;
    surface1: string;
    surface2: string;
    surface3: string;
    surface4: string;
    border: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    accent: string;
    fontMono: string;
  };
  /** Take the Escape key while something of yours is open that Escape should
   *  close (an edit mode whose handles sit over the photo, a popover): the
   *  newest taker gets the key, ahead of an on-image tool, and a slider's
   *  value field keeps it for its own revert. Returns the function that
   *  gives the key back: call it as soon as there is nothing left to close,
   *  from a React effect's cleanup. Needs Safelight 3.2.4. */
  onEscape(handler: () => void): () => void;
}

/** Who made a write or a registration. */
export interface VariableWriter {
  extension: string;
  window: string;
}

/** Higher n wins; an equal n is broken by window id. */
export interface VariableRevision {
  n: number;
  window: string;
}

export interface VariableSnapshot<T> {
  name: string;
  /** Deep-frozen. */
  value: T;
  revision: VariableRevision;
  writer: VariableWriter;
  registeredBy: VariableWriter;
  description?: string;
}

export type VariableWriteResult<T> =
  | { ok: true; revision: VariableRevision }
  | { ok: false; reason: "stale"; current: VariableSnapshot<T> }
  | { ok: false; reason: "unregistered" }
  | { ok: false; reason: "invalid"; message: string };

/** Core's shared variables (Safelight 3.0.1+): named JSON values every
 *  extension can share across windows. A set() from an extension that hasn't
 *  seen the current value is refused; update() reads and writes the latest. */
export interface SharedVariablesAPI {
  register<T>(name: string, init: { initial: T; description?: string }): VariableSnapshot<T>;
  get<T>(name: string): VariableSnapshot<T> | undefined;
  subscribe<T>(name: string, listener: (snapshot: VariableSnapshot<T>) => void): () => void;
  set<T>(name: string, value: T): VariableWriteResult<T>;
  update<T>(name: string, fn: (current: T) => T): VariableWriteResult<T>;
}

export interface SafelightAPI {
  version: 1;
  extensionId: string;
  react: typeof import("react");
  registerModule(c: ModuleContribution): void;
  registerPanel(c: PanelContribution): void;
  registerKeybinding(c: KeyActionContribution): void;
  /** Re-registering the same id replaces the predicate; there is no unregister. */
  registerGridFilter(c: GridFilterContribution): void;
  registerGridMenuItem(c: GridMenuItemContribution): void;
  registerSettings(c: SettingsContribution): void;
  registerStylesheet(c: StylesheetContribution): void;
  registerSlot(c: SlotContribution): void;
  settings: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): void;
    onChange(cb: (key: string, value: unknown) => void): () => void;
  };
  ui: UiKit;
  components: {
    Thumbnail: ComponentType<ThumbnailProps>;
    /** The right-click menu core surfaces use, placed at client `x`/`y` and
     *  kept in the viewport. Closes on an outside click, Escape, scroll, or
     *  choosing an item. */
    ContextMenu: (props: ContextMenuProps) => JSX.Element;
  };
  stores: {
    create<T>(init: StateCreator<T>): StoreApi<T>;
    useCatalogStore: StoreApi<CatalogState>;
    useUIStore: StoreApi<UIState>;
    useThemeStore: StoreApi<ThemeStoreState>;
  };
  navigation: {
    goTo(module: string): void;
    /** The module this window was popped out for, or null in the main
     *  window. Needs Safelight 3.2.7. */
    ownModule(): string | null;
  };
  develop: {
    /** The pointer in `el`'s layout px: the space an overlay's `rect`, the
     *  mapping helpers and CSS left/top use. Interface scale zooms the page,
     *  so clientX minus the element's left is off by the zoom. Needs Safelight
     *  3.2.7. */
    framePoint(el: Element, clientX: number, clientY: number): {
      x: number;
      y: number;
    };
  };
  catalog: {
    useVisiblePhotos(options?: { without?: readonly string[] }): CatalogPhoto[];
    usePhotoActions(): PhotoActions;
    useCullingShortcuts(options?: CullingShortcutOptions): void;
    requestThumbnail(photoId: string): void;
  };
  variables: SharedVariablesAPI;
}

export interface ExtensionModule {
  activate(api: SafelightAPI): void;
  deactivate?(): void;
}

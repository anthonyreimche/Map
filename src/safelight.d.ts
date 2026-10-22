import type {
  ComponentType,
  CSSProperties,
  DragEvent as ReactDragEvent,
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
  /** Persists the records and updates this window's catalog. Other windows get
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
  };
  stores: {
    create<T>(init: StateCreator<T>): StoreApi<T>;
    useCatalogStore: StoreApi<CatalogState>;
    useUIStore: StoreApi<UIState>;
    useThemeStore: StoreApi<ThemeStoreState>;
  };
  navigation: { goTo(module: string): void };
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

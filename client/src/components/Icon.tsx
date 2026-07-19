// One hand-rolled inline SVG icon set. 1.5px stroke, 20px grid.
// Covers collection icon keys, log-type keys, and UI icons (DESIGN §5.1 + prompt).
import type { ReactNode, SVGProps } from 'react';

// Each entry returns the inner SVG paths of a 24x24 viewBox (stroke = currentColor).
const ICONS: Record<string, ReactNode> = {
  // ---- Collection icons ----
  firearm: (
    <>
      <path d="M3 8h16a1 1 0 0 1 1 1v2h-4l-2 3h-3l-1-2H6l-1 3H3z" />
      <path d="M9 11v3" />
      <path d="M14 8V6h3" />
    </>
  ),
  ammo: (
    <>
      <rect x="8" y="9" width="8" height="11" rx="1" />
      <path d="M12 9V6a2 2 0 0 0-2-2h4a2 2 0 0 0-2 2" />
      <path d="M8 13h8" />
    </>
  ),
  knife: (
    <>
      <path d="M3 17l11-11a5 5 0 0 1 4 4L7 21z" />
      <path d="M7 21l-2-2" />
      <path d="M5 19l-2 1 1-2" />
    </>
  ),
  coin: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
    </>
  ),
  stamp: (
    <>
      <path d="M9 8a3 3 0 1 1 6 0c0 1.5-1 2-1 3h-4c0-1-1-1.5-1-3z" />
      <rect x="5" y="14" width="14" height="6" rx="1" />
      <path d="M5 17h14" />
    </>
  ),
  box: (
    <>
      <path d="M4 8l8-4 8 4v8l-8 4-8-4z" />
      <path d="M4 8l8 4 8-4" />
      <path d="M12 12v8" />
    </>
  ),
  watch: (
    <>
      <circle cx="12" cy="12" r="5.5" />
      <path d="M12 9.5V12l1.5 1.5" />
      <path d="M9 6.5l.5-2.5h5l.5 2.5" />
      <path d="M9 17.5l.5 2.5h5l.5-2.5" />
    </>
  ),
  camera: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <circle cx="12" cy="13.5" r="3.5" />
      <path d="M8 7l1.5-2.5h5L16 7" />
    </>
  ),
  book: (
    <>
      <path d="M5 4h9a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2z" />
      <path d="M16 6h3v14h-3" />
      <path d="M9 8h4" />
    </>
  ),
  card: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 14h4" />
    </>
  ),
  gem: (
    <>
      <path d="M6 4h12l3 5-9 11L3 9z" />
      <path d="M3 9h18" />
      <path d="M9 4l-3 5 6 11 6-11-3-5" />
    </>
  ),
  guitar: (
    <>
      <circle cx="9" cy="15" r="5" />
      <circle cx="9" cy="15" r="1.5" />
      <path d="M12.5 11.5l6-6" />
      <path d="M17 4l3 3-1.5 1.5-3-3z" />
    </>
  ),
  medal: (
    <>
      <circle cx="12" cy="15" r="5" />
      <path d="M12 15l1 1" />
      <path d="M9 10.5L6.5 4h4L12 8" />
      <path d="M15 10.5L17.5 4h-4L12 8" />
    </>
  ),
  bottle: (
    <>
      <path d="M10 3h4v3l1 2v11a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2V8l1-2z" />
      <path d="M9 12h6" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" />
      <path d="M10 12h4" />
    </>
  ),
  star: <path d="M12 3l2.7 5.9 6.3.7-4.7 4.3 1.3 6.1L12 17l-5.6 3 1.3-6.1L3 9.6l6.3-.7z" />,

  // ---- Log-type icons ----
  target: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" />
    </>
  ),
  brush: (
    <>
      <path d="M15 4l5 5-7 7H8v-5z" />
      <path d="M4 16c2 0 3 1 3 3s-2 2-4 2c1-1 1-2 1-3s0-2 0-2z" />
    </>
  ),
  wrench: <path d="M15 5a4 4 0 0 0 4.5 6.5L21 13l-8 8-1.5-1.5A4 4 0 0 0 5 15L3 13l8-8z" />,
  badge: (
    <>
      <path d="M12 3l2 2 3-.5.5 3 2 2-2 2-.5 3-3-.5-2 2-2-2-3 .5-.5-3-2-2 2-2 .5-3 3 .5z" />
      <circle cx="12" cy="11" r="2.5" />
    </>
  ),
  'arrow-up': (
    <>
      <path d="M12 20V5" />
      <path d="M6 11l6-6 6 6" />
    </>
  ),
  'arrow-down': (
    <>
      <path d="M12 4v15" />
      <path d="M6 13l6 6 6-6" />
    </>
  ),
  note: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5" />
      <path d="M9 12h6" />
      <path d="M9 16h4" />
    </>
  ),
  droplet: <path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z" />,
  edge: (
    <>
      <path d="M4 18L18 4l2 2L6 20z" />
      <path d="M4 18l2 2" />
    </>
  ),

  // ---- UI icons ----
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="M20 20l-5-5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1" />
      <rect x="13" y="4" width="7" height="7" rx="1" />
      <rect x="4" y="13" width="7" height="7" rx="1" />
      <rect x="13" y="13" width="7" height="7" rx="1" />
    </>
  ),
  'table-view': (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M3 15h18" />
      <path d="M9 5v14" />
    </>
  ),
  filter: <path d="M4 5h16l-6 7v6l-4 2v-8z" />,
  sort: (
    <>
      <path d="M7 5v14M7 5l-3 3M7 5l3 3" />
      <path d="M17 19V5M17 19l-3-3M17 19l3-3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1" />
    </>
  ),
  back: <path d="M15 5l-7 7 7 7" />,
  'chevron-left': <path d="M15 5l-7 7 7 7" />,
  'chevron-right': <path d="M9 5l7 7-7 7" />,
  'chevron-down': <path d="M5 9l7 7 7-7" />,
  'chevron-up': <path d="M5 15l7-7 7 7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  restore: (
    <>
      <path d="M4 12a8 8 0 1 1 2.3 5.6" />
      <path d="M4 20v-4h4" />
    </>
  ),
  edit: (
    <>
      <path d="M4 20l4-1L19 8l-3-3L5 16z" />
      <path d="M14 5l5 5" />
    </>
  ),
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M7 9l5-5 5 5" />
      <path d="M4 20h16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <path d="M7 11l5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  qr: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M20 14v.01M14 20v.01M17 20h3v-3" />
    </>
  ),
  print: (
    <>
      <path d="M6 9V3h12v6" />
      <rect x="4" y="9" width="16" height="8" rx="2" />
      <path d="M8 17h8v4H8z" />
      <path d="M17 12.5h.01" />
    </>
  ),
  tag: (
    <>
      <path d="M3 12l8-8 9 1 1 9-8 8z" />
      <circle cx="15" cy="9" r="1.5" />
    </>
  ),
  check: <path d="M5 12l4.5 4.5L19 6" />,
  warning: (
    <>
      <path d="M12 3l9 16H3z" />
      <path d="M12 10v4" />
      <path d="M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 8h.01" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 13v6H5V6h6" />
    </>
  ),
  kebab: (
    <>
      <circle cx="12" cy="5" r="1.3" />
      <circle cx="12" cy="12" r="1.3" />
      <circle cx="12" cy="19" r="1.3" />
    </>
  ),
  'drag-handle': (
    <>
      <circle cx="9" cy="6" r="1.2" />
      <circle cx="15" cy="6" r="1.2" />
      <circle cx="9" cy="12" r="1.2" />
      <circle cx="15" cy="12" r="1.2" />
      <circle cx="9" cy="18" r="1.2" />
      <circle cx="15" cy="18" r="1.2" />
    </>
  ),
  moon: <path d="M20 14a8 8 0 1 1-9-11 6.5 6.5 0 0 0 9 11z" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1" />
    </>
  ),
  wifi: (
    <>
      <path d="M2 8.5a15 15 0 0 1 20 0" />
      <path d="M5 12a10 10 0 0 1 14 0" />
      <path d="M8.5 15.5a5 5 0 0 1 7 0" />
      <path d="M12 19h.01" />
    </>
  ),
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="16" rx="2" />
      <path d="M4 9h16" />
      <path d="M8 3v4M16 3v4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  photo: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="8.5" cy="10" r="1.5" />
      <path d="M21 16l-5-5-9 8" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v4h4" />
    </>
  ),
  dollar: (
    <>
      <path d="M12 3v18" />
      <path d="M16 7.5C16 6 14.5 5 12 5S8 6 8 8s2 2.5 4 3 4 1.5 4 3.5-1.5 3-4 3-4-1-4-2.5" />
    </>
  ),
  history: (
    <>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v4h4" />
      <path d="M12 8v4l3 2" />
    </>
  ),
  layers: (
    <>
      <path d="M12 3l9 5-9 5-9-5z" />
      <path d="M3 12l9 5 9-5" />
      <path d="M3 16l9 5 9-5" />
    </>
  ),
  home: (
    <>
      <path d="M4 11l8-7 8 7" />
      <path d="M6 10v9h12v-9" />
      <path d="M10 19v-5h4v5" />
    </>
  ),
  link: (
    <>
      <path d="M9 15l6-6" />
      <path d="M10 6l1-1a4 4 0 0 1 6 6l-1 1" />
      <path d="M14 18l-1 1a4 4 0 0 1-6-6l1-1" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  'eye-off': (
    <>
      <path d="M4 4l16 16" />
      <path d="M9.5 9.6A3 3 0 0 0 14.4 14.5" />
      <path d="M6.5 6.6C3.6 8.2 2 12 2 12s3.5 7 10 7c1.9 0 3.5-.5 5-1.2" />
      <path d="M9.8 5.2A9.7 9.7 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6" />
      <path d="M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l3 3v15H5z" />
      <path d="M8 3v5h7V3" />
      <rect x="8" y="13" width="8" height="6" />
    </>
  ),
  spark: (
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
  ),
};

export type IconName = string;

interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...rest }: IconProps) {
  const inner = ICONS[name] ?? ICONS.box;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {inner}
    </svg>
  );
}

export const COLLECTION_ICON_KEYS = [
  'firearm', 'ammo', 'knife', 'coin', 'stamp', 'box', 'watch', 'camera',
  'book', 'card', 'gem', 'guitar', 'medal', 'bottle', 'archive', 'star',
] as const;

export function hasIcon(name: string): boolean {
  return name in ICONS;
}

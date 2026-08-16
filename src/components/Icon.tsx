import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "portal" | "dna" | "chat" | "generate" | "library" | "gallery" | "projects"
  | "flows" | "queue" | "analytics" | "settings" | "runtime" | "search" | "bell"
  | "arrow" | "chevron" | "chevronDown" | "plus" | "play" | "pause" | "video"
  | "image" | "music" | "voice" | "cube" | "copy" | "send" | "star" | "sun"
  | "moon" | "wand" | "rerun" | "check" | "close" | "grid" | "more" | "archive"
  | "shield" | "history" | "external";

type IconProps = {
  name: IconName;
  size?: number;
  style?: CSSProperties;
  className?: string;
};

function Svg({ size = 22, style, className, children }: Omit<IconProps, "name"> & { children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
      strokeLinecap="round" strokeLinejoin="round" style={style} className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export function Icon({ name, ...props }: IconProps) {
  const paths: Partial<Record<IconName, ReactNode>> = {
    portal: <><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.8v2M12 18.2v2M3.8 12h2M18.2 12h2"/></>,
    dna: <><path d="M7 3c0 6 10 6 10 12 0 2.6-1.8 4.8-4.4 6"/><path d="M17 3c0 6-10 6-10 12 0 2.6 1.8 4.8 4.4 6"/><path d="M8.2 7h7.6M7.2 12h9.6M8.2 17h7.6"/></>,
    chat: <path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5V16H4a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 4 5.5Z"/>,
    generate: <><path d="M5 3.5l1.2 2.6L9 7.3 6.2 8.5 5 11 3.8 8.5 1 7.3l2.8-1.2L5 3.5Z"/><path d="M16 8l1.8 3.8L22 13.6l-4.2 1.8L16 19.5l-1.8-4.1L10 13.6l4.2-1.8L16 8Z"/></>,
    library: <><rect x="3.5" y="4" width="5" height="16" rx="1.2"/><rect x="10" y="4" width="5" height="16" rx="1.2"/><path d="M16.6 5.4l3.2.9-3.2 12-1-.3"/></>,
    gallery: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 16l4.5-4 3.5 3 3-2.5 5 4.5"/></>,
    projects: <><path d="M12 3.2 21 8l-9 4.8L3 8l9-4.8Z"/><path d="M3 13l9 4.8L21 13M3 16.5l9 4.8 9-4.8" opacity=".55"/></>,
    flows: <><circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="18" r="2.4"/><path d="M6 8.4v3a2 2 0 0 0 2 2h3.5M18 8.4v3a2 2 0 0 1-2 2h-3.5"/></>,
    queue: <><circle cx="12" cy="12" r="8.4"/><path d="M12 7v5l3.2 2"/></>,
    analytics: <path d="M4 19V5M4 19h16M8 19v-6M12 19V8M16 19v-9M20 19V6"/>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5M18.7 18.7l-1.5-1.5M6.8 6.8 5.3 5.3"/></>,
    runtime: <path d="M9 7V4.5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2V7M7 9h10a2 2 0 0 1 2 2v3a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5v-3a2 2 0 0 1 2-2Z"/>,
    search: <><circle cx="11" cy="11" r="6.6"/><path d="m20 20-4.2-4.2"/></>,
    bell: <path d="M6 9.5a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5ZM10 19a2 2 0 0 0 4 0"/>,
    arrow: <path d="M5 12h14M13 6l6 6-6 6"/>,
    chevron: <path d="m9 6 6 6-6 6"/>,
    chevronDown: <path d="m6 9 6 6 6-6"/>,
    plus: <path d="M12 5v14M5 12h14"/>,
    play: <path d="M7 4.5v15l13-7.5L7 4.5Z" fill="currentColor" stroke="none"/>,
    pause: <><rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/></>,
    video: <><rect x="3" y="6" width="13" height="12" rx="2.4"/><path d="m16 10 5-3v10l-5-3"/></>,
    image: <><rect x="3.5" y="4.5" width="17" height="15" rx="2.4"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 16 4.5-4 3.5 3 3-2.5L20 17"/></>,
    music: <><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></>,
    voice: <><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></>,
    cube: <><path d="M12 3.2 21 8v8l-9 4.8L3 16V8l9-4.8Z"/><path d="m3 8 9 4.8L21 8M12 12.8V20.8" opacity=".6"/></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2.2"/><path d="M16 8V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2H8"/></>,
    send: <path d="M5 12 21 4l-6 16-3.5-6.5L5 12Z"/>,
    star: <path d="M12 4l2.3 4.9 5.2.6-3.9 3.6 1 5.3L12 16.4 7.4 18l1-5.3L4.5 9.5l5.2-.6L12 4Z"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M22 12h-2.5M4.5 12H2M19 5l-1.8 1.8M6.8 17.2 5 19M19 19l-1.8-1.8M6.8 6.8 5 5"/></>,
    moon: <path d="M20 14.5A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10.5Z"/>,
    wand: <path d="m6 19 9-9M14 5l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2ZM5 14l.7 1.4L7 16l-1.3.6L5 18l-.7-1.4L3 16l1.3-.6L5 14Z"/>,
    rerun: <path d="M20 11a8 8 0 1 0-.8 4M20 5v4h-4"/>,
    check: <path d="m5 12.5 4.5 4.5L19 7"/>,
    close: <path d="M6 6l12 12M18 6 6 12"/>,
    grid: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></>,
    more: <><circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/></>,
    archive: <><path d="M4 7h16v13H4zM3 4h18v3H3z"/><path d="M9 11h6"/></>,
    shield: <><path d="M12 3 20 6v5c0 5-3.3 8.4-8 10-4.7-1.6-8-5-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></>,
    history: <><path d="M4 12a8 8 0 1 0 2-5.3L4 9"/><path d="M4 4v5h5M12 7v5l3 2"/></>,
    external: <><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/></>,
  };
  return <Svg {...props}>{paths[name] ?? paths.generate}</Svg>;
}

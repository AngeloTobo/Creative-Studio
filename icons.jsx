/* icons.jsx — line icon set (1.6 stroke, 24 grid) */
const Ic = ({ d, size = 22, fill, sw = 1.7, children, vb = 24, style }) => (
  <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill={fill || 'none'}
    stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round"
    style={style} aria-hidden="true">
    {d ? <path d={d} /> : children}
  </svg>
);

const Icons = {
  portal: (p) => <Ic {...p}>{<><circle cx="12" cy="12" r="8.2"/><circle cx="12" cy="12" r="3.2"/><path d="M12 3.8v2M12 18.2v2M3.8 12h2M18.2 12h2"/></>}</Ic>,
  chat: (p) => <Ic {...p} d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5H9l-4 3.5V16H4a1.5 1.5 0 0 1-1.5-1.5V7A1.5 1.5 0 0 1 4 5.5Z"/>,
  generate: (p) => <Ic {...p}>{<><path d="M5 3.5l1.2 2.6L9 7.3 6.2 8.5 5 11 3.8 8.5 1 7.3l2.8-1.2L5 3.5Z"/><path d="M16 8l1.8 3.8L22 13.6l-4.2 1.8L16 19.5l-1.8-4.1L10 13.6l4.2-1.8L16 8Z"/></>}</Ic>,
  library: (p) => <Ic {...p}>{<><rect x="3.5" y="4" width="5" height="16" rx="1.2"/><rect x="10" y="4" width="5" height="16" rx="1.2"/><path d="M16.6 5.4l3.2.9-3.2 12-1-.3"/></>}</Ic>,
  gallery: (p) => <Ic {...p}>{<><rect x="3.5" y="4.5" width="17" height="15" rx="2.2"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M4 16l4.5-4 3.5 3 3-2.5 5 4.5"/></>}</Ic>,
  projects: (p) => <Ic {...p}>{<><path d="M12 3.2 21 8l-9 4.8L3 8l9-4.8Z"/><path d="M3 13l9 4.8L21 13M3 16.5l9 4.8 9-4.8" opacity=".55"/></>}</Ic>,
  flows: (p) => <Ic {...p}>{<><circle cx="6" cy="6" r="2.4"/><circle cx="18" cy="6" r="2.4"/><circle cx="12" cy="18" r="2.4"/><path d="M6 8.4v3a2 2 0 0 0 2 2h3.5M18 8.4v3a2 2 0 0 1-2 2h-3.5"/></>}</Ic>,
  queue: (p) => <Ic {...p}>{<><circle cx="12" cy="12" r="8.4"/><path d="M12 7v5l3.2 2"/></>}</Ic>,
  analytics: (p) => <Ic {...p} d="M4 19V5M4 19h16M8 19v-6M12 19V8M16 19v-9M20 19V6"/>,
  settings: (p) => <Ic {...p}>{<><circle cx="12" cy="12" r="3"/><path d="M12 2.5v2.2M12 19.3v2.2M21.5 12h-2.2M4.7 12H2.5M18.7 5.3l-1.5 1.5M6.8 17.2l-1.5 1.5M18.7 18.7l-1.5-1.5M6.8 6.8 5.3 5.3"/></>}</Ic>,
  integrations: (p) => <Ic {...p} d="M9 7V4.5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2V7M7 9h10a2 2 0 0 1 2 2v3a5 5 0 0 1-5 5h-4a5 5 0 0 1-5-5v-3a2 2 0 0 1 2-2Z"/>,
  search: (p) => <Ic {...p}>{<><circle cx="11" cy="11" r="6.6"/><path d="m20 20-4.2-4.2"/></>}</Ic>,
  bell: (p) => <Ic {...p} d="M6 9.5a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4s2-1.5 2-6.5ZM10 19a2 2 0 0 0 4 0"/>,
  arrow: (p) => <Ic {...p} d="M5 12h14M13 6l6 6-6 6"/>,
  chevron: (p) => <Ic {...p} d="m9 6 6 6-6 6"/>,
  chevronDown: (p) => <Ic {...p} d="m6 9 6 6 6-6"/>,
  plus: (p) => <Ic {...p} d="M12 5v14M5 12h14"/>,
  play: (p) => <Ic {...p} fill="currentColor" sw="0" d="M7 4.5v15l13-7.5L7 4.5Z"/>,
  pause: (p) => <Ic {...p}>{<><rect x="6.5" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2" fill="currentColor" stroke="none"/></>}</Ic>,
  prev: (p) => <Ic {...p}>{<><path d="M18 5.5v13L9 12l9-6.5Z" fill="currentColor" stroke="none"/><rect x="5.5" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none"/></>}</Ic>,
  next: (p) => <Ic {...p}>{<><path d="M6 5.5v13L15 12 6 5.5Z" fill="currentColor" stroke="none"/><rect x="16.1" y="5" width="2.4" height="14" rx="1" fill="currentColor" stroke="none"/></>}</Ic>,
  shuffle: (p) => <Ic {...p} d="M3 17h3.5L17 7h4M18 4l3 3-3 3M3 7h3.5l3 3M14.5 14 17 17h4M18 20l3-3"/>,
  repeat: (p) => <Ic {...p} d="M17 3l3 3-3 3M20 6H8a4 4 0 0 0-4 4M7 21l-3-3 3-3M4 18h12a4 4 0 0 0 4-4"/>,
  volume: (p) => <Ic {...p} d="M4 9.5v5h3l4.5 3.5v-12L7 9.5H4ZM16 9a4 4 0 0 1 0 6M18.5 6.5a7 7 0 0 1 0 11"/>,
  heart: (p) => <Ic {...p} d="M12 20s-7-4.4-7-9.4A3.9 3.9 0 0 1 12 7a3.9 3.9 0 0 1 7 3.6c0 5-7 9.4-7 9.4Z"/>,
  dots: (p) => <Ic {...p}>{<><circle cx="12" cy="5.5" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="18.5" r="1.5" fill="currentColor" stroke="none"/></>}</Ic>,
  more: (p) => <Ic {...p}>{<><circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/></>}</Ic>,
  video: (p) => <Ic {...p}>{<><rect x="3" y="6" width="13" height="12" rx="2.4"/><path d="m16 10 5-3v10l-5-3"/></>}</Ic>,
  image: (p) => <Ic {...p}>{<><rect x="3.5" y="4.5" width="17" height="15" rx="2.4"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="m4 16 4.5-4 3.5 3 3-2.5L20 17"/></>}</Ic>,
  music: (p) => <Ic {...p}>{<><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></>}</Ic>,
  voice: (p) => <Ic {...p}>{<><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/></>}</Ic>,
  cube: (p) => <Ic {...p}>{<><path d="M12 3.2 21 8v8l-9 4.8L3 16V8l9-4.8Z"/><path d="m3 8 9 4.8L21 8M12 12.8V20.8" opacity=".6"/></>}</Ic>,
  copy: (p) => <Ic {...p}>{<><rect x="8" y="8" width="12" height="12" rx="2.2"/><path d="M16 8V5.5a2 2 0 0 0-2-2H5.5a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2H8"/></>}</Ic>,
  edit: (p) => <Ic {...p} d="M4 20h4L19 9l-4-4L4 16v4ZM14 6l4 4"/>,
  send: (p) => <Ic {...p} d="M5 12 21 4l-6 16-3.5-6.5L5 12Z"/>,
  attach: (p) => <Ic {...p} d="M20 11.5 12 19.5a5 5 0 0 1-7-7l8.5-8.5a3.3 3.3 0 0 1 4.7 4.7L9 16.5a1.6 1.6 0 0 1-2.3-2.3L14 7"/>,
  star: (p) => <Ic {...p} d="M12 4l2.3 4.9 5.2.6-3.9 3.6 1 5.3L12 16.4 7.4 18l1-5.3L4.5 9.5l5.2-.6L12 4Z"/>,
  sun: (p) => <Ic {...p}>{<><circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M22 12h-2.5M4.5 12H2M19 5l-1.8 1.8M6.8 17.2 5 19M19 19l-1.8-1.8M6.8 6.8 5 5"/></>}</Ic>,
  moon: (p) => <Ic {...p} d="M20 14.5A8 8 0 1 1 10 4a6.5 6.5 0 0 0 10 10.5Z"/>,
  wand: (p) => <Ic {...p} d="m6 19 9-9M14 5l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2ZM5 14l.7 1.4L7 16l-1.3.6L5 18l-.7-1.4L3 16l1.3-.6L5 14Z"/>,
  rerun: (p) => <Ic {...p} d="M20 11a8 8 0 1 0-.8 4M20 5v4h-4"/>,
  check: (p) => <Ic {...p} d="m5 12.5 4.5 4.5L19 7"/>,
  close: (p) => <Ic {...p} d="M6 6l12 12M18 6 6 18"/>,
  grid: (p) => <Ic {...p}>{<><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></>}</Ic>,
  menu: (p) => <Ic {...p} d="M4 7h16M4 12h16M4 17h16"/>,
  upload: (p) => <Ic {...p} d="M12 16V5m0 0L8 9m4-4 4 4M5 19h14"/>,
  sliders: (p) => <Ic {...p} d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M6 14v6"/>,
};

window.Icons = Icons;
window.Ic = Ic;

// Consistent stroke icon set - no emoji in UI chrome.
const PATHS: Record<string, React.ReactNode> = {
  home: (<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /><path d="M9.5 21v-6h5v6" /></>),
  plus: (<><circle cx="12" cy="12" r="8.5" /><path d="M12 8.5v7M8.5 12h7" /></>),
  tray: (<><path d="M3.5 13.5 6 5.5h12l2.5 8" /><path d="M3.5 13.5h5l1.2 2h4.6l1.2-2h5v5.5h-17z" /></>),
  gauge: (<><rect x="3.5" y="3.5" width="17" height="17" rx="2" /><path d="M7.5 15v3M12 10v8M16.5 13v5" /></>),
  tag: (<><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.4" /></>),
  receipt: (<><path d="M5.5 3.5h13V21l-2.2-1.4L14 21l-2-1.4L10 21l-2.3-1.4L5.5 21z" /><path d="M9 8.5h6M9 12.5h6" /></>),
  mail: (<><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 5.5L20 7" /></>),
  search: (<><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>),
  camera: (<><path d="M4 8h2.6L8.5 5h7L17.4 8H20v11H4z" /><circle cx="12" cy="13" r="3.4" /></>),
  check: (<path d="m5 12.5 4.5 4.5L19 7.5" />),
  warn: (<><path d="M12 3.5 2.5 20h19z" /><path d="M12 10v4.5M12 17.2v.3" /></>),
  sync: (<><path d="M4.5 12a7.5 7.5 0 0 1 13-5.1l2.6 2.6" /><path d="M20.5 4.5v5h-5" /><path d="M19.5 12a7.5 7.5 0 0 1-13 5.1l-2.6-2.6" /><path d="M3.5 19.5v-5h5" /></>),
  pen: (<><path d="M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19z" /><path d="m14.5 6.5 3 3" /></>),
  cloud: (<path d="M7 18.5a4.5 4.5 0 0 1-.4-9A6 6 0 0 1 18.2 11a4 4 0 0 1 .3 7.5z" />),
};

export function Icon({ name, size = 22 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name as string]}
    </svg>
  );
}

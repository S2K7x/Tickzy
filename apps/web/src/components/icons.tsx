import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 18): SVGProps<SVGSVGElement> => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
  strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
});

export const OverviewIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></svg>);
export const InboxIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M3 13h5l2 3h4l2-3h5" /><path d="M5.5 5h13L21 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6z" /></svg>);
export const MineIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>);
export const AccountsIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M3 21V7l6-4 6 4v14" /><path d="M15 21V11h6v10M3 21h18M7 9h4M7 13h4M7 17h4" /></svg>);
export const SparkIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>);
export const BookIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5M8 7h7" /></svg>);
export const ChartIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>);
export const SettingsIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" /></svg>);
export const MenuIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 6h16M4 12h16M4 18h16" /></svg>);
export const SearchIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>);
export const MoonIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>);
export const SunIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>);
export const PlusIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>);

export const ChevronDownIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="m6 9 6 6 6-6" /></svg>);
export const PanelIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M14 4v16" /></svg>);
export const KeyboardIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><rect x="2" y="6" width="20" height="12" rx="2.5" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></svg>);
export const LogoutIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" /></svg>);
export const FilterIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M4 6h16M7 12h10M10 18h4" /></svg>);
export const FileIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>);
export const ClockIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>);
export const HourglassIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9" /></svg>);
export const CheckCircleIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>);
export const ZapIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><path d="M13 3 4 14h7l-1 7 9-11h-7z" /></svg>);
export const MoreIcon = ({ size, ...p }: P) => (<svg {...base(size)} {...p}><circle cx="12" cy="5" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="12" cy="19" r="1" /></svg>);

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Tickzy">
      <rect width="32" height="32" rx="9" fill="var(--primary)" />
      <path d="M8 11.5a1.5 1.5 0 0 1 1.5-1.5h13a1.5 1.5 0 0 1 1.5 1.5v2a2.5 2.5 0 0 0 0 5v2a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 8 20.5v-2a2.5 2.5 0 0 0 0-5z" fill="var(--primary-text)" />
    </svg>
  );
}

import type { SVGProps } from "react";

/**
 * Small stroke icon set shared across the workspace UI. Stroke style matches the
 * sidebar nav icons (1.6 width, round caps) so everything reads as one family.
 * Icons inherit color via currentColor and size via the `size` prop.
 */
function Icon({ size = 15, children, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function CalendarIcon(props: { size?: number }) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
    </Icon>
  );
}

export function BuildingIcon(props: { size?: number }) {
  return (
    <Icon {...props}>
      <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3" />
    </Icon>
  );
}

export function CashIcon(props: { size?: number }) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 9.5v5M18 9.5v5" />
    </Icon>
  );
}

export function MapPinIcon(props: { size?: number }) {
  return (
    <Icon {...props}>
      <path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </Icon>
  );
}

export function StarIcon(props: { size?: number; filled?: boolean }) {
  const { filled, ...rest } = props;
  return (
    <Icon {...rest} fill={filled ? "currentColor" : "none"}>
      <path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.86L12 17.9l-5.25 2.76 1-5.86L3.5 9.66l5.9-.86Z" />
    </Icon>
  );
}

export function LinkIcon(props: { size?: number }) {
  return (
    <Icon {...props}>
      <path d="M10 13a4 4 0 0 0 5.66 0l2.5-2.5a4 4 0 0 0-5.66-5.66L11.5 6" />
      <path d="M14 11a4 4 0 0 0-5.66 0l-2.5 2.5a4 4 0 0 0 5.66 5.66L12.5 18" />
    </Icon>
  );
}

export function InfoIcon(props: { size?: number }) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 7.5h.01" />
    </Icon>
  );
}

export function SearchIcon(props: { size?: number }) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </Icon>
  );
}

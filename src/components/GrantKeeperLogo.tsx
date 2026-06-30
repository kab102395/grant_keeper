type LogoTone = "onLight" | "onDark";

/**
 * Grant Keeper product mark — a keeper's shield cradling the ember flame.
 * The shield reads as "keep / safeguard your grants"; the flame carries the
 * Ember Tech spark. Distinct from the Ember Tech hexagon mark, but clearly the
 * same family. Crisp SVG so it holds up from 24px chrome to splash sizes.
 */
export function GrantKeeperLogo({
  size = 28,
  tone = "onLight",
}: {
  size?: number;
  tone?: LogoTone;
}) {
  const shield = tone === "onDark" ? "#f5f7fb" : "#202448";
  const flameWarm = "#ed6f1c";
  const flameCool = tone === "onDark" ? "#cfd6e8" : "#202448";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Grant Keeper"
    >
      <path
        d="M16 2.5 L27 6.6 V15 C27 22.6 22 27.2 16 29.8 C10 27.2 5 22.6 5 15 V6.6 Z"
        fill="none"
        stroke={shield}
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
      <path d="M16 9 C12 14.4, 12 17.8, 13.7 20.6 C14.5 21.6, 15.3 21.9, 16 21.9 Z" fill={flameWarm} />
      <path d="M16 9 C20 14.4, 20 17.8, 18.3 20.6 C17.5 21.6, 16.7 21.9, 16 21.9 Z" fill={flameCool} />
    </svg>
  );
}

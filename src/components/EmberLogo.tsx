type EmberLogoTone = "onLight" | "onDark";

/**
 * Grant Keeper / Ember Tech monogram — a hexagon enclosing a two-tone flame.
 * Recreated as crisp SVG so it stays sharp from 24px chrome up to splash sizes.
 * `onLight` for white surfaces (navy hexagon), `onDark` for the navy sidebar
 * (ember hexagon so the mark reads against dark chrome).
 */
export function EmberLogo({
  size = 30,
  tone = "onLight",
}: {
  size?: number;
  tone?: EmberLogoTone;
}) {
  const hex = tone === "onDark" ? "#ed6f1c" : "#202448";
  const flameWarm = "#ed6f1c";
  const flameCool = tone === "onDark" ? "#f5f7fb" : "#202448";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label="Grant Keeper"
    >
      <polygon
        points="16,2 28.1,9 28.1,23 16,30 3.9,23 3.9,9"
        fill="none"
        stroke={hex}
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M16 7 C11 14, 11 18, 13 21.5 C14 22.7, 15 23, 16 23 Z" fill={flameWarm} />
      <path d="M16 7 C21 14, 21 18, 19 21.5 C18 22.7, 17 23, 16 23 Z" fill={flameCool} />
    </svg>
  );
}

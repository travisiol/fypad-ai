/** The FYPAD tile: pink → violet rounded square, a white rounded "f" and a small sparkle (AI). */
export function LogoTile({ size = 28, id = "fy" }: { size?: number; id?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}-g`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FF3D7F" />
          <stop offset="1" stopColor="#7B61FF" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#${id}-g)`} />
      <path d="M37 15.5c-6.4 0-10.2 3.8-10.2 10.4V29h-4.6v6.8h4.6V50h7.8V35.8h6v-6.8h-6v-2.6c0-2.3 1-3.4 3.2-3.4H41v-7.5z" fill="#fff" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
      <path d="M48 12c.5 3.4 1.9 4.8 5.3 5.3-3.4.5-4.8 1.9-5.3 5.3-.5-3.4-1.9-4.8-5.3-5.3 3.4-.5 4.8-1.9 5.3-5.3z" fill="#fff" />
    </svg>
  );
}

/** Lowercase "fypad" in Bricolage Grotesque 800 with the gradient sparkle dot. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`}>
      fypad
      <span className="wordmark-dot" aria-hidden="true" />
    </span>
  );
}

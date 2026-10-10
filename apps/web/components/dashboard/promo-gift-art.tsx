/**
 * The invite card's art: an open teal glass gift box with a silver ribbon, a
 * coin rising out of it and coins stacked beside it. Drawn as SVG so it stays
 * sharp at any size and needs no image request.
 */
export function PromoGiftArt({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={className}
      fill="none"
      focusable="false"
      viewBox="0 0 220 200"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="pg-box-front" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#5fd3cf" stopOpacity="0.92" />
          <stop offset="1" stopColor="#0f8f8c" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="pg-box-side" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#2bb3ae" stopOpacity="0.9" />
          <stop offset="1" stopColor="#0a6f6d" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="pg-lid" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#8be6e1" stopOpacity="0.95" />
          <stop offset="1" stopColor="#1aa7a2" stopOpacity="0.95" />
        </linearGradient>
        <linearGradient id="pg-ribbon" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#d9dee3" />
          <stop offset="0.5" stopColor="#ffffff" />
          <stop offset="1" stopColor="#a8b0b8" />
        </linearGradient>
        <linearGradient id="pg-coin" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f4f6f8" />
          <stop offset="0.55" stopColor="#c3cad1" />
          <stop offset="1" stopColor="#8b949d" />
        </linearGradient>
        <linearGradient id="pg-coin-edge" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#9aa3ac" />
          <stop offset="1" stopColor="#5f6871" />
        </linearGradient>
        <radialGradient id="pg-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#7ee0da" stopOpacity="0.55" />
          <stop offset="1" stopColor="#7ee0da" stopOpacity="0" />
        </radialGradient>
      </defs>

      <ellipse cx="118" cy="182" fill="url(#pg-glow)" rx="95" ry="20" />

      {/* Coin stack, left */}
      {[0, 1, 2].map((index) => (
        <g key={`l-${index}`} transform={`translate(0 ${-index * 9})`}>
          <ellipse cx="44" cy="178" fill="url(#pg-coin-edge)" rx="26" ry="9" />
          <ellipse cx="44" cy="173" fill="url(#pg-coin)" rx="26" ry="9" />
        </g>
      ))}

      {/* Box sides */}
      <path d="M150 110 L178 98 L178 170 L150 184 Z" fill="url(#pg-box-side)" />
      <path d="M72 110 L150 110 L150 184 L72 184 Z" fill="url(#pg-box-front)" />
      <path d="M72 110 L150 110 L150 184 L72 184 Z" fill="#ffffff" fillOpacity="0.08" />
      <path d="M78 116 L92 116 L92 178 L78 178 Z" fill="#ffffff" fillOpacity="0.22" />

      {/* Ribbon down the box */}
      <path d="M104 110 L118 110 L118 184 L104 184 Z" fill="url(#pg-ribbon)" />
      <path d="M160 105 L168 101 L168 174 L160 178 Z" fill="url(#pg-ribbon)" opacity="0.9" />

      {/* The coin rising out of the box */}
      <g transform="rotate(-14 112 78)">
        <ellipse cx="112" cy="80" fill="url(#pg-coin-edge)" rx="30" ry="30" />
        <circle cx="110" cy="76" fill="url(#pg-coin)" r="29" />
        <circle cx="110" cy="76" r="22" stroke="#8b949d" strokeOpacity="0.6" strokeWidth="2" />
        <text
          fill="#6b747d"
          fontFamily="Sora, Arial, sans-serif"
          fontSize="30"
          fontWeight="800"
          textAnchor="middle"
          x="110"
          y="87"
        >
          $
        </text>
      </g>

      {/* Lid, tipped open */}
      <g transform="rotate(-18 150 66)">
        <path d="M118 58 L192 58 L200 52 L126 52 Z" fill="#9ff0ea" fillOpacity="0.9" />
        <path d="M118 58 L192 58 L192 76 L118 76 Z" fill="url(#pg-lid)" />
        <path d="M150 58 L162 58 L162 76 L150 76 Z" fill="url(#pg-ribbon)" />
        {/* Bow */}
        <path d="M156 52 C140 30 128 40 142 52 Z" fill="url(#pg-ribbon)" stroke="#a8b0b8" strokeWidth="1" />
        <path d="M156 52 C172 30 186 40 170 52 Z" fill="url(#pg-ribbon)" stroke="#a8b0b8" strokeWidth="1" />
      </g>

      {/* Coin stack, right */}
      {[0, 1].map((index) => (
        <g key={`r-${index}`} transform={`translate(0 ${-index * 9})`}>
          <ellipse cx="196" cy="186" fill="url(#pg-coin-edge)" rx="22" ry="8" />
          <ellipse cx="196" cy="181" fill="url(#pg-coin)" rx="22" ry="8" />
        </g>
      ))}
    </svg>
  );
}

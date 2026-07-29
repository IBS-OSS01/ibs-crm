import React from 'react'

/**
 * IBS brand logo — inline SVG, no external assets needed.
 * Props:
 *   size     — badge size in px (default 72)
 *   showText — show "India Business Suite" text below badge (default true)
 *   light    — use light text (default true, for dark backgrounds)
 */
export default function IBSLogo({ size = 72, showText = true, light = true }) {
  const r = size / 2          // radius for viewBox calculations
  const textColor = light ? '#FFFFFF' : '#1e293b'
  const subtitleColor = light ? '#94a3b8' : '#64748b'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '14px' }}>
      {/* ── Badge ── */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={{ filter: 'drop-shadow(0 8px 24px rgba(59,130,246,0.45))' }}
      >
        <defs>
          <linearGradient id="ibs-grad-bg" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#1D4ED8" />
            <stop offset="100%" stopColor="#4F46E5" />
          </linearGradient>
          <linearGradient id="ibs-grad-accent" x1="0" y1="0" x2="100" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%"   stopColor="#60A5FA" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#818CF8" stopOpacity="0" />
          </linearGradient>
          <clipPath id="ibs-clip">
            <rect x="0" y="0" width="100" height="100" rx="24" ry="24" />
          </clipPath>
        </defs>

        {/* Background tile */}
        <rect x="0" y="0" width="100" height="100" rx="24" ry="24" fill="url(#ibs-grad-bg)" />

        {/* Subtle diagonal highlight */}
        <ellipse cx="70" cy="30" rx="55" ry="40" fill="url(#ibs-grad-accent)" clipPath="url(#ibs-clip)" />

        {/* Inner border ring */}
        <rect x="4" y="4" width="92" height="92" rx="20" ry="20"
          fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />

        {/* "IBS" letters */}
        <text
          x="50" y="62"
          textAnchor="middle"
          fontFamily="'Segoe UI', Arial, sans-serif"
          fontWeight="800"
          fontSize="36"
          letterSpacing="1"
          fill="#FFFFFF"
        >
          IBS
        </text>

        {/* Thin accent line under text */}
        <line x1="28" y1="70" x2="72" y2="70"
          stroke="rgba(255,255,255,0.30)" strokeWidth="1.5" strokeLinecap="round" />
      </svg>

      {/* ── Wordmark ── */}
      {showText && (
        <div style={{ textAlign: 'center', lineHeight: '1.2' }}>
          <p style={{
            margin: 0,
            fontSize: '22px',
            fontWeight: 700,
            color: textColor,
            fontFamily: "'Segoe UI', Arial, sans-serif",
            letterSpacing: '0.5px',
          }}>
            India Business Suite
          </p>
          <p style={{
            margin: '4px 0 0',
            fontSize: '13px',
            color: subtitleColor,
            fontFamily: "'Segoe UI', Arial, sans-serif",
            letterSpacing: '0.3px',
          }}>
            Enterprise Management Platform
          </p>
        </div>
      )}
    </div>
  )
}

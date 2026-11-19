#!/usr/bin/env python3
# Generates the Ondura app logos (apps/ondura/public/*.svg). One shared
# recipe: a rounded tile in the app colour (subtle top-to-bottom shading,
# light upper edge) carrying a white object with details in the app colour.
#
#   python3 scripts/logos.py
#
# The desktop icons are rendered from these SVGs afterwards: the suite icon
# with `npx tauri icon <1024px ondura.png>`, the per-app icons
# (src-tauri/icons/apps/*.png|ico) at 256 px.
import os
OUT = os.path.join(os.path.dirname(__file__), "..", "apps", "ondura", "public")
def hx(c): return tuple(int(c[i:i+2],16) for i in (1,3,5))
def mix(a,b,t): A,B=hx(a),hx(b); return '#%02x%02x%02x'%tuple(round(x+(y-x)*t) for x,y in zip(A,B))

def tile(color, glyph, name):
    top = mix(color, '#ffffff', 0.16)
    bot = mix(color, '#000000', 0.18)
    ink = mix(color, '#000000', 0.08)
    soft = mix(color, '#ffffff', 0.78)
    g = glyph(ink, soft)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="t" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{top}"/>
      <stop offset="1" stop-color="{bot}"/>
    </linearGradient>
    <linearGradient id="p" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/>
      <stop offset="1" stop-color="{mix(color, '#ffffff', 0.9)}"/>
    </linearGradient>
    <filter id="d" x="-20%" y="-20%" width="140%" height="150%">
      <feDropShadow dx="0" dy="1.2" stdDeviation="1.3" flood-color="#000" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect x="4" y="4" width="56" height="56" rx="14" fill="url(#t)"/>
  <rect x="4.5" y="4.5" width="55" height="55" rx="13.5" fill="none" stroke="#fff" stroke-opacity="0.22"/>
  <g filter="url(#d)">
{g}
  </g>
</svg>
'''
    open(os.path.join(OUT, f'{name}.svg'), 'w').write(svg)

def text(ink, soft):
    return f'''    <path d="M21 13h15.5L45 21.5V48a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3V16a3 3 0 0 1 3-3z" fill="url(#p)"/>
    <path d="M36.5 13v6a2.5 2.5 0 0 0 2.5 2.5h6" fill="{soft}"/>
    <path d="M23.5 26h10" stroke="{ink}" stroke-width="3" stroke-linecap="round"/>
    <path d="M23.5 32.5h16M23.5 38h16M23.5 43.5h10" stroke="{ink}" stroke-opacity="0.55" stroke-width="2.4" stroke-linecap="round"/>'''

def sheets(ink, soft):
    return f'''    <rect x="14" y="16" width="36" height="32" rx="4" fill="url(#p)"/>
    <path d="M14 20a4 4 0 0 1 4-4h28a4 4 0 0 1 4 4v4H14z" fill="{ink}"/>
    <path d="M26 24v24M38 24v24M14 32h36M14 40h36" stroke="{ink}" stroke-opacity="0.35" stroke-width="1.6"/>
    <rect x="27.5" y="33.5" width="9" height="5" rx="1" fill="{ink}" fill-opacity="0.85"/>'''

def slides(ink, soft):
    return f'''    <rect x="12" y="15" width="40" height="28" rx="4" fill="url(#p)"/>
    <path d="M17.5 22h14" stroke="{ink}" stroke-width="3" stroke-linecap="round"/>
    <path d="M17.5 28h11M17.5 33h8" stroke="{ink}" stroke-opacity="0.55" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M40 26a7 7 0 1 1-7 7h7z" fill="{ink}"/>
    <path d="M41.5 24.5a7 7 0 0 1 7 7h-7z" fill="{ink}" fill-opacity="0.45"/>
    <path d="M32 43v5M25 49h14" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>'''

def mail(ink, soft):
    return f'''    <rect x="12" y="18" width="40" height="28" rx="4.5" fill="url(#p)"/>
    <path d="M13.5 21.5 32 34.5l18.5-13" fill="none" stroke="{ink}" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M14.5 44 26.5 30.5M49.5 44 37.5 30.5" stroke="{ink}" stroke-opacity="0.3" stroke-width="2" stroke-linecap="round"/>'''

def ondura(ink, soft):
    return f'''    <circle cx="32" cy="32" r="14.5" fill="none" stroke="#fff" stroke-width="7"/>
    <path d="M17.5 33.5c4.8-4.6 9.7-4.6 14.5 0s9.7 4.6 14.5 0" fill="none" stroke="{soft}" stroke-width="4.2" stroke-linecap="round"/>'''

tile('#2b5bd7', text, 'text')
tile('#107c41', sheets, 'sheets')
tile('#c43e1c', slides, 'slides')
tile('#3b5bdb', mail, 'mail')
tile('#3b5bdb', ondura, 'ondura')

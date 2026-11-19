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

def pdf(ink, soft):
    return f'''    <path d="M21 13h15.5L45 21.5V48a3 3 0 0 1-3 3H21a3 3 0 0 1-3-3V16a3 3 0 0 1 3-3z" fill="url(#p)"/>
    <path d="M36.5 13v6a2.5 2.5 0 0 0 2.5 2.5h6" fill="{soft}"/>
    <path d="M23.5 25.5h9M23.5 30.5h14" stroke="{ink}" stroke-opacity="0.45" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M23 42.5c2.6-6.2 4.8-8.4 5.6-6.6.9 2-1.6 7-.4 7.4 1.2.4 3.2-5 4.6-4.6 1.2.4.2 3.6 1.4 3.8 1.1.2 2.6-1.8 4.3-2.2" fill="none" stroke="{ink}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M23.5 46.5h17" stroke="{ink}" stroke-opacity="0.35" stroke-width="1.6" stroke-linecap="round"/>'''

def ondura(ink, soft):
    return f'''    <circle cx="32" cy="32" r="14.5" fill="none" stroke="#fff" stroke-width="7"/>
    <path d="M17.5 33.5c4.8-4.6 9.7-4.6 14.5 0s9.7 4.6 14.5 0" fill="none" stroke="{soft}" stroke-width="4.2" stroke-linecap="round"/>'''

def notes(ink, soft):
    return f'''    <rect x="17" y="12" width="30" height="40" rx="3.5" fill="url(#p)"/>
    <rect x="17" y="12" width="7.5" height="40" rx="3.5" fill="{ink}"/>
    <path d="M24.5 12v40" stroke="{ink}" stroke-width="1"/>
    <path d="M47 18h3.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H47z" fill="#fff" fill-opacity="0.85"/>
    <path d="M47 29h3.5a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5H47z" fill="#fff" fill-opacity="0.55"/>
    <path d="M29 22h13" stroke="{ink}" stroke-width="2.8" stroke-linecap="round"/>
    <path d="M29 29h12M29 35h12M29 41h8" stroke="{ink}" stroke-opacity="0.5" stroke-width="2.2" stroke-linecap="round"/>'''

def planner(ink, soft):
    return f'''    <rect x="12" y="14" width="40" height="36" rx="4" fill="url(#p)"/>
    <rect x="16" y="19" width="9" height="7" rx="1.6" fill="{ink}"/>
    <rect x="16" y="28.5" width="9" height="7" rx="1.6" fill="{ink}" fill-opacity="0.45"/>
    <rect x="27.5" y="19" width="9" height="7" rx="1.6" fill="{ink}" fill-opacity="0.45"/>
    <rect x="27.5" y="28.5" width="9" height="7" rx="1.6" fill="{ink}"/>
    <rect x="27.5" y="38" width="9" height="7" rx="1.6" fill="{ink}" fill-opacity="0.45"/>
    <rect x="39" y="19" width="9" height="7" rx="1.6" fill="{ink}" fill-opacity="0.45"/>
    <path d="m40.6 22.6 2 2 3.4-3.6" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'''

def diagram(ink, soft):
    return f'''    <rect x="11" y="13" width="17" height="11" rx="2.5" fill="url(#p)"/>
    <rect x="36" y="13" width="17" height="11" rx="2.5" fill="url(#p)"/>
    <path d="m32 35 9.5 6.5L32 48l-9.5-6.5z" fill="url(#p)"/>
    <path d="M28 18.5h6M19.5 24v8.5a3 3 0 0 0 3 3h3.5M44.5 24v8.5a3 3 0 0 1-3 3H38" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M14.5 18.5h10M39.5 18.5h10" stroke="{ink}" stroke-width="2.2" stroke-linecap="round" stroke-opacity="0.6"/>
    <circle cx="32" cy="41.5" r="2.2" fill="{ink}"/>'''

def forms(ink, soft):
    return f'''    <rect x="16" y="13" width="32" height="40" rx="3.5" fill="url(#p)"/>
    <rect x="25" y="10" width="14" height="6" rx="2" fill="#fff" stroke="{ink}" stroke-width="1.4"/>
    <rect x="20.5" y="23" width="5.5" height="5.5" rx="1.2" fill="{ink}"/>
    <path d="m21.6 25.8 1.4 1.4 2.2-2.4" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M29.5 25.8h13" stroke="{ink}" stroke-opacity="0.55" stroke-width="2.2" stroke-linecap="round"/>
    <circle cx="23.3" cy="35" r="2.8" fill="none" stroke="{ink}" stroke-width="1.6"/>
    <path d="M29.5 35h13" stroke="{ink}" stroke-opacity="0.55" stroke-width="2.2" stroke-linecap="round"/>
    <rect x="20.5" y="41.5" width="22" height="6" rx="1.5" fill="none" stroke="{ink}" stroke-opacity="0.6" stroke-width="1.5"/>'''

tile('#2b5bd7', text, 'text')
tile('#107c41', sheets, 'sheets')
tile('#c43e1c', slides, 'slides')
tile('#3b5bdb', mail, 'mail')
tile('#c4314b', pdf, 'pdf')
tile('#3b5bdb', ondura, 'ondura')
tile('#7719aa', notes, 'notes')
tile('#0b7a75', planner, 'planner')
tile('#4f52b2', diagram, 'diagram')
tile('#c27c0e', forms, 'forms')

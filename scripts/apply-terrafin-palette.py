#!/usr/bin/env python3
"""把 MCPWindow 官网样式从 lime 绿橙体系重映射到 TerraFin 星际地平线色卡。

色卡：落日红 #E4572E / 星空紫 #3B2A5A / 暮光蓝 #4A6FA5 / 雾灰白 #F2EFEA / 夜幕黑 #1C1A24
"""
import pathlib, sys

CSS = pathlib.Path('/Users/sim/Documents/MCPServer/repo/MCPWindow/website/styles.css')
text = CSS.read_text()

# (旧值, 新值) —— 全部为精确子串替换；顺序无关，因为映射目标不互相包含。
MAP = [
    # ---------- 基础变量 ----------
    ('--black:#0a0b0d', '--black:#1C1A24'),                 # 夜幕黑
    ('--ink:#f4f1e9', '--ink:#F2EFEA'),                      # 雾灰白
    ('--muted:#a6a39c', '--muted:#A89FBA'),
    ('--line:rgba(244,241,233,.19)', '--line:rgba(242,239,234,.19)'),
    ('--lime:#d9ff68', '--lime:#E4572E'),                   # 品牌强调 → 落日红
    ('--orange:#f15a3b', '--orange:#4A6FA5'),                # 辅助 → 暮光蓝

    # ---------- 首页 hero 基础态 ----------
    ('background:#171c1c', 'background:#1C1A24'),
    ('rgba(129,184,121,.64)', 'rgba(74,111,165,.55)'),
    ('rgba(201,213,145,.27)', 'rgba(228,87,46,.25)'),
    ('linear-gradient(110deg,#121515 9%,#293334 62%,#798a77 150%)',
     'linear-gradient(110deg,#1C1A24 9%,#2A2340 62%,#4A6FA5 150%)'),
    ('rgba(227,255,120,.45)', 'rgba(228,87,46,.45)'),
    ('rgba(239,255,204,.42)', 'rgba(242,239,234,.35)'),
    ('rgba(217,255,104,.12)', 'rgba(228,87,46,.12)'),
    ('rgba(238,255,213,.65)', 'rgba(242,239,234,.5)'),
    ('rgba(231,255,187,.35),rgba(23,42,42,.92) 55%,#121918',
     'rgba(228,87,46,.4),rgba(59,42,90,.92) 55%,#1C1A24'),
    ('rgba(221,255,105,.31)', 'rgba(228,87,46,.3)'),
    ('#e5ffac', '#FFD0BC'),
    ('#e6ffd6', '#F2D9CC'),
    ('color:#d5d6d0', 'color:#B9B4C4'),

    # ---------- manifesto / cinema ----------
    ('background:#eeece5', 'background:#F2EFEA'),
    ('.manifesto .kicker{color:#4d504d}', '.manifesto .kicker{color:#6B6478}'),
    ('.manifesto h2 i{font-style:normal;color:#71866d}', '.manifesto h2 i{font-style:normal;color:#4A6FA5}'),
    ('color:#535652', 'color:#55505E'),
    ('border-bottom:1px solid #292d2b', 'border-bottom:1px solid #3B3352'),
    ('background:#111518', 'background:#1C1A24'),
    ('rgba(245,255,230,.43)', 'rgba(242,239,234,.3)'),
    ('background:#202a3b', 'background:#3B2A5A'),
    ('color:#aaafbc', 'color:#9A93A8'),
    ('color:#778494', 'color:#8B8499'),
    ('color:#7a8493', 'color:#8B8499'),
    ('color:#8490a0', 'color:#8E8799'),
    ('color:#747d7b', 'color:#8B8499'),
    ('rgba(187,255,113,.19)', 'rgba(59,42,90,.4)'),

    # ---------- principles（橙底深字 → 星空紫底雾灰白字） ----------
    ('background:#f15a3b;color:#1a1511', 'background:#3B2A5A;color:#F2EFEA'),
    ('background:#f66b44', 'background:#3B2A5A'),
    ('.principle-head .kicker{color:#583329}', '.principle-head .kicker{color:#C9A3B8}'),
    ('rgba(29,20,16,.5)', 'rgba(242,239,234,.25)'),
    ('color:#503127', 'color:#C4BCCF'),

    # ---------- companion / closing ----------
    ('background:#15201e', 'background:#232031'),
    ('radial-gradient(circle at 50% 43%,#3c654f 0,transparent 36%),linear-gradient(135deg,#15201e,#0e1514)',
     'radial-gradient(circle at 50% 43%,#4A3568 0,transparent 36%),linear-gradient(135deg,#2A2140,#1C1A24)'),
    ('radial-gradient(circle at 33% 28%,#c8f099 0,#89a57e 13%,#476158 37%,#172321 70%)',
     'radial-gradient(circle at 33% 28%,#FFD0BC 0,#E4572E 13%,#3B2A5A 37%,#1C1A24 70%)'),
    ('rgba(187,255,116,.13)', 'rgba(228,87,46,.18)'),
    ('rgba(232,255,215,.48)', 'rgba(242,239,234,.35)'),
    ('rgba(12,21,22,.86)', 'rgba(35,32,49,.86)'),
    ('color:#e2eed8', 'color:#F2EFEA'),
    ('color:#8eaa9b', 'color:#A89FBA'),
    ('rgba(222,246,216,.63)', 'rgba(242,239,234,.5)'),
    ('background:#e7e4da', 'background:#F2EFEA'),
    ('color:#60645e', 'color:#6B6478'),
    ('color:#758a75', 'color:#4A6FA5'),
    ('background:#161a19', 'background:#1C1A24'),

    # ---------- footer ----------
    ('background:#141615', 'background:#1C1A24'),
    ('color:#d7d6d0', 'color:#B9B4C4'),
    ('color:#9a9e95', 'color:#837D94'),

    # ---------- 下载页 ----------
    ('background:#d9d7ce', 'background:#F2EFEA'),
    ('color:#5b625c', 'color:#6B6478'),
    ('color:#768c76', 'color:#4A6FA5'),
    ('background:#e9e7df', 'background:#FFFFFF'),
    ('background:#c7ff67', 'background:#E4572E'),
    ('background:#171c19;color:#f0f3ed', 'background:#1C1A24;color:#F2EFEA'),
    ('border:1px solid #252a26', 'border:1px solid #3B3352'),

    # ---------- 紫橙变体覆盖块（对齐到色卡） ----------
    ('.hero{background:#1b1035}', '.hero{background:#1C1A24}'),
    ('rgba(255,91,57,.88)', 'rgba(228,87,46,.85)'),
    ('rgba(133,68,232,.62)', 'rgba(74,111,165,.5)'),
    ('linear-gradient(118deg,#120824 8%,#301451 57%,#ff704a 145%)',
     'linear-gradient(118deg,#1C1A24 8%,#3B2A5A 57%,#E4572E 145%)'),
    ('rgba(255,171,132,.66)', 'rgba(242,169,132,.6)'),
    ('rgba(255,91,57,.75)', 'rgba(228,87,46,.7)'),
    ('#ff754e', '#E4572E'),
    ('rgba(249,169,255,.51)', 'rgba(242,239,234,.4)'),
    ('rgba(154,80,255,.25)', 'rgba(74,111,165,.25)'),
    ('rgba(255,138,93,.59),rgba(57,21,101,.94) 55%,#150b2b',
     'rgba(228,87,46,.55),rgba(59,42,90,.94) 55%,#1C1A24'),
    ('rgba(255,99,63,.34)', 'rgba(228,87,46,.3)'),
    ('#ff774f', '#E4572E'),
    ('#a66dff', '#7FA8D9'),
    ('background:#f2dfd8', 'background:#F2EFEA'),
    ('color:#8b3c62', 'color:#3B2A5A'),
    ('background:#160d31', 'background:#1C1A24'),
    ('rgba(182,86,255,.32)', 'rgba(74,111,165,.3)'),
    ('background:#170b31 url', 'background:#1C1A24 url'),
    ('color:#c6aebd', 'color:#A89FBA'),
    ('background:#28124e', 'background:#232031'),
    ('radial-gradient(circle at 50% 43%,#81346b 0,transparent 36%)',
     'radial-gradient(circle at 50% 43%,#4A3568 0,transparent 36%)'),
    ('linear-gradient(135deg,#25114a,#100724)', 'linear-gradient(135deg,#2A2140,#1C1A24)'),
    ('radial-gradient(circle at 33% 28%,#ffb18f 0,#ec714d 13%,#75388d 37%,#1a1235 70%)',
     'radial-gradient(circle at 33% 28%,#FFD0BC 0,#E4572E 13%,#3B2A5A 37%,#1C1A24 70%)'),
    ('rgba(166,91,255,.28)', 'rgba(228,87,46,.2)'),
    ('rgba(27,10,53,.88)', 'rgba(59,42,90,.88)'),
    ('color:#ff9b79', 'color:#F2A180'),
    ('#ff906b', '#E4572E'),
    ('background:#edcfc7', 'background:#F2EFEA'),
    ('color:#6f4183', 'color:#3B2A5A'),
    ('background:#2a104d', 'background:#1C1A24'),
    ('#ff744f', '#E4572E'),
    ('background:#e8cfca', 'background:#F2EFEA'),
    ('background:#e8d5e1', 'background:#FFFFFF'),
    ('#29104e', '#3B2A5A'),

    # ---------- 功能状态色 ----------
    ('#abf575', '#7FA8D9'),
    ('#d9ff68', '#E4572E'),
    ('#b7ec7a', '#7FA8D9'),
    ('#adf277', '#7FA8D9'),
    ('#b4ed77', '#7FA8D9'),
    ('#baf87c', '#7FA8D9'),
]

missing, applied = [], []
for old, new in MAP:
    count = text.count(old)
    if count == 0:
        missing.append(old)
    else:
        text = text.replace(old, new)
        applied.append((old, new, count))

CSS.write_text(text)
print(f'applied {len(applied)} rules')
for old, new, count in applied:
    print(f'  {count:3d}x  {old[:64]} -> {new[:40]}')
if missing:
    print('\nNOT FOUND (check manually):')
    for old in missing:
        print('  -', old)
    sys.exit(1)

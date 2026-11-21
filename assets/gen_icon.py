# -*- coding: utf-8 -*-
"""把 AI 生成的「药罐」图做成「易圣验方」的图标套件

处理思路：
1. 裁出圆角卡片本体（源图外圈是白底）
2. 用水印上方底色覆盖右下角「元宝AI生成」水印
3. 按饱和度/明度分出"纸底"与"药罐主体"，纸底换成干净的赭石径向渐变（药罐边缘膨胀 9px 保护，不外溢）
4. 加内缩细金线（与易圣验方印章图标的金线同族，形成产品线感）
5. 圆角裁切，输出商店 1024/512、五个密度、自适应前景与背景色
"""
import os
from PIL import Image, ImageDraw, ImageFilter

SRC = r'C:\Users\zhong\.workbuddy\clipboard-images\clipboard-2026-11-18T10-06-33-077Z-7ccbe483.jpg'
OUT = r'C:\Users\zhong\WorkBuddy\2026-11-13-20-55-39\yanfang-app\assets\icon'
CARD = (48, 45, 1495, 1492)
WM = (1360, 1400, 1500, 1500)          # 水印外扩一点
GOLD = (235, 192, 120)
RADIUS_PCT = 0.185


def hsv(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    v = mx / 255.0
    s = 0 if mx == 0 else (mx - mn) / mx
    if mx == mn:
        hh = 0
    elif mx == r:
        hh = (60 * (g - b) / (mx - mn)) % 360
    elif mx == g:
        hh = 60 * (b - r) / (mx - mn) + 120
    else:
        hh = 60 * (r - g) / (mx - mn) + 240
    return hh, s, v


def radial(w, h, inner, outer):
    """小图径向渐变再放大，省算力"""
    small = Image.new('RGB', (96, 96))
    d = ImageDraw.Draw(small)
    cx, cy = 48, 46
    maxd = (48 ** 2 + 48 ** 2) ** 0.5
    for y in range(96):
        for x in range(96):
            t = min(1.0, ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 / maxd)
            t = t ** 1.15
            c = tuple(int(inner[i] + (outer[i] - inner[i]) * t) for i in range(3))
            d.point((x, y), c)
    return small.resize((w, h), Image.BICUBIC)


def main():
    os.makedirs(OUT, exist_ok=True)
    im = Image.open(SRC).convert('RGB').crop(CARD)
    S = im.size[0]
    print('card', im.size)

    # 1) 水印区用其上方底色覆盖
    px = im.load()
    acc = [0, 0, 0]
    n = 0
    for y in range(1330, 1390):
        for x in range(1350, S - 20):
            r, g, b = px[x, y]
            acc[0] += r; acc[1] += g; acc[2] += b; n += 1
    base = tuple(v // n for v in acc)
    print('cover color', base)
    ImageDraw.Draw(im).rectangle(WM, fill=base)

    # 2) 分底/主体
    mask = Image.new('L', (S, S), 255)      # 255 = 保护（药罐）
    mp = mask.load()
    for y in range(S):
        for x in range(S):
            r, g, b = px[x, y]
            hh, ss, vv = hsv(r, g, b)
            is_bg = (0.40 < ss < 0.85) and (0.42 < vv < 0.96) and (10 < hh < 42)
            if is_bg:
                mp[x, y] = 0
    mask = mask.filter(ImageFilter.MaxFilter(9))       # 膨胀，护住药罐边缘过渡
    mask = mask.filter(ImageFilter.GaussianBlur(3))

    # 3) 换底
    grad = radial(S, S, (208, 136, 84), (150, 78, 38))
    out = Image.composite(im, grad, mask)

    # 4) 金线内框（画在圆角裁切之前的方形画布上，跟随圆角）
    inset = int(S * 0.052)
    lw = max(2, int(S * 0.0075))
    d = ImageDraw.Draw(out)
    d.rounded_rectangle([inset, inset, S - inset, S - inset],
                        radius=int(S * RADIUS_PCT) - int(inset * 0.45),
                        outline=GOLD, width=lw)

    # 5) 圆角遮罩
    rmask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(rmask).rounded_rectangle([0, 0, S - 1, S - 1],
                                            radius=int(S * RADIUS_PCT), fill=255)
    out = out.convert('RGBA')
    out.putalpha(rmask)

    # 6) 输出
    out.resize((1024, 1024), Image.LANCZOS).save(os.path.join(OUT, 'icon-1024.png'), optimize=True)
    out.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, 'icon-512.png'), optimize=True)
    for name, size in (('mdpi', 48), ('hdpi', 72), ('xhdpi', 96),
                       ('xxhdpi', 144), ('xxxhdpi', 192), ('playstore', 512)):
        out.resize((size, size), Image.LANCZOS).save(
            os.path.join(OUT, 'launcher-%s-%d.png' % (name, size)), optimize=True)

    # 7) 自适应图标：前景=内容缩到 72% 透明居中；背景=纯赭色
    fg = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    k = int(S * 0.72)
    fg.paste(out.resize((k, k), Image.LANCZOS), ((S - k) // 2, (S - k) // 2), out.resize((k, k), Image.LANCZOS))
    fg.resize((432, 432), Image.LANCZOS).save(os.path.join(OUT, 'adaptive-foreground-432.png'), optimize=True)
    bgc = radial(432, 432, (208, 136, 84), (150, 78, 38))
    bgc.save(os.path.join(OUT, 'adaptive-background-432.png'), optimize=True)
    print('background color for xml: #%02X%02X%02X' % (176, 104, 58))

    # 8) 站内 header 用小图（无金线版更适合小尺寸，先给带金线的）
    out.resize((128, 128), Image.LANCZOS).save(os.path.join(OUT, 'logo-128.png'), optimize=True)
    out.resize((256, 256), Image.LANCZOS).save(os.path.join(OUT, 'logo-256.png'), optimize=True)
    print('done →', OUT)


if __name__ == '__main__':
    main()

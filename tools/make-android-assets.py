# -*- coding: utf-8 -*-
"""
【已废弃】图标改用 上架素材/图标方案/gen-book-icon.py + tools/apply-icon.py（书封图标）。
本脚本生成的是旧的红底「拾」字印章与拉伸式启动图，保留仅作参考。

生成 Android 原生资源：应用图标（含自适应图标）与启动图
用法：python tools/make-android-assets.py

配色与 app/www/css/app.css 同一套：
  纸色 #f6f2e9 / 朱砂 #a8341f / 金 #96773c / 墨 #23201b
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RES = os.path.join(ROOT, 'app', 'android', 'app', 'src', 'main', 'res')

PAPER = '#f6f2e9'
SEAL = '#a8341f'
GOLD = '#96773c'
INK = '#23201b'
INK_3 = '#918779'

F_SERIF = 'C:/Windows/Fonts/simsun.ttc'
F_SANS = 'C:/Windows/Fonts/msyh.ttc'


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def put_glyph(d, box, ch, fnt, fill, dy=0.0):
    """在 (x0,y0,x1,y1) 里居中画一个字"""
    x0, y0, x1, y1 = box
    bbox = d.textbbox((0, 0), ch, font=fnt)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((x0 + x1 - w) / 2 - bbox[0], (y0 + y1 - h) / 2 - bbox[1] + dy),
           ch, font=fnt, fill=fill)


def icon_square(size):
    """传统图标：圆角红底 + 细金线 + 纸色「拾」"""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=SEAL)
    inset = int(size * 0.085)
    d.rounded_rectangle([inset, inset, size - 1 - inset, size - 1 - inset],
                        radius=int(r * 0.55), outline=GOLD,
                        width=max(1, round(size / 128)))
    put_glyph(d, (0, 0, size, size), '拾', font(F_SERIF, int(size * 0.56)), PAPER,
              dy=-size * 0.01)
    return im


def icon_round(size):
    """圆形图标：朱砂圆底 + 金环 + 纸色「拾」"""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    s = size - 1
    d.ellipse([0, 0, s, s], fill=SEAL)
    inset = int(size * 0.09)
    d.ellipse([inset, inset, s - inset, s - inset], outline=GOLD,
              width=max(1, round(size / 128)))
    put_glyph(d, (0, 0, size, size), '拾', font(F_SERIF, int(size * 0.52)), PAPER,
              dy=-size * 0.01)
    return im


def icon_foreground(size):
    """自适应图标前景：透明底 + 金环 + 纸色「拾」，内容收在中央安全区（约 62%）"""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c = size / 2
    ring = size * 0.58
    d.ellipse([c - ring / 2, c - ring / 2, c + ring / 2, c + ring / 2],
              outline=GOLD, width=max(1, round(size / 108)))
    put_glyph(d, (0, 0, size, size), '拾', font(F_SERIF, int(size * 0.33)), PAPER,
              dy=-size * 0.008)
    return im


def splash(w, h):
    """启动图：纸色底 + 居中印章 + 「易圣验方」+ 一行小字"""
    im = Image.new('RGB', (w, h), PAPER)
    d = ImageDraw.Draw(im)
    m = min(w, h)

    seal = int(m * 0.20)
    cx, cy = w / 2, h * 0.42
    box = [cx - seal / 2, cy - seal / 2, cx + seal / 2, cy + seal / 2]
    d.rounded_rectangle(box, radius=int(seal * 0.22), fill=SEAL)
    inset = int(seal * 0.085)
    d.rounded_rectangle([box[0] + inset, box[1] + inset,
                         box[2] - inset, box[3] - inset],
                        radius=int(seal * 0.12), outline=GOLD,
                        width=max(1, round(seal / 90)))
    f = font(F_SERIF, int(seal * 0.56))
    bbox = d.textbbox((0, 0), '拾', font=f)
    d.text((cx - (bbox[2] - bbox[0]) / 2 - bbox[0],
            cy - (bbox[3] - bbox[1]) / 2 - bbox[1] - seal * 0.01),
           '拾', font=f, fill=PAPER)

    fs = font(F_SERIF, int(m * 0.085))
    name = '拾　方'
    tw = d.textlength(name, font=fs)
    d.text((cx - tw / 2, cy + seal * 0.62), name, font=fs, fill=INK)

    ft = font(F_SANS, int(m * 0.036))
    tag = '方剂资料检索'
    tw2 = d.textlength(tag, font=ft)
    d.text((cx - tw2 / 2, cy + seal * 0.62 + m * 0.115), tag, font=ft, fill=INK_3)
    return im


DENSITIES = {           # 目录: (传统图标边长, 自适应前景边长)
    'mdpi': (48, 108),
    'hdpi': (72, 162),
    'xhdpi': (96, 216),
    'xxhdpi': (144, 324),
    'xxxhdpi': (192, 432),
}

SPLASHES = {
    'drawable/splash.png': (480, 320),
    'drawable-land-mdpi/splash.png': (480, 320),
    'drawable-land-hdpi/splash.png': (800, 480),
    'drawable-land-xhdpi/splash.png': (1280, 720),
    'drawable-land-xxhdpi/splash.png': (1600, 960),
    'drawable-land-xxxhdpi/splash.png': (1920, 1280),
    'drawable-port-mdpi/splash.png': (320, 480),
    'drawable-port-hdpi/splash.png': (480, 800),
    'drawable-port-xhdpi/splash.png': (720, 1280),
    'drawable-port-xxhdpi/splash.png': (960, 1600),
    'drawable-port-xxxhdpi/splash.png': (1280, 1920),
}


def main():
    for name, (a, fg) in DENSITIES.items():
        d = os.path.join(RES, 'mipmap-' + name)
        os.makedirs(d, exist_ok=True)
        icon_square(a).save(os.path.join(d, 'ic_launcher.png'))
        icon_round(a).save(os.path.join(d, 'ic_launcher_round.png'))
        icon_foreground(fg).save(os.path.join(d, 'ic_launcher_foreground.png'))
        print('图标 %-8s %d/%d' % (name, a, fg))

    for rel, (w, h) in SPLASHES.items():
        p = os.path.join(RES, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        splash(w, h).save(p)
        print('启动图 %-32s %dx%d' % (rel, w, h))

    # 自适应图标底色 / 主题色
    with open(os.path.join(RES, 'values/ic_launcher_background.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="ic_launcher_background">%s</color>\n</resources>\n' % SEAL)

    with open(os.path.join(RES, 'values/colors.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="colorPrimary">%s</color>\n'
                '    <color name="colorPrimaryDark">#8c2a19</color>\n'
                '    <color name="colorAccent">%s</color>\n'
                '    <color name="paper">%s</color>\n'
                '</resources>\n' % (SEAL, GOLD, PAPER))
    print('颜色资源已写入 values/colors.xml')


if __name__ == '__main__':
    main()

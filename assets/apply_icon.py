# -*- coding: utf-8 -*-
"""把 assets/icon 里的主图铺进 Android 各密度，并生成启动标志

- ic_launcher.png：各密度方图（PNG 内已带圆角）
- ic_launcher_round.png：圆形遮罩版
- ic_launcher_foreground.png：自适应前景（内容 72%，透明外圈）
- splash_logo.png：1080x1400 纸底 + 药罐 + 站名 + 一行小字
"""
import os
from PIL import Image, ImageDraw, ImageFont

R = r'C:\Users\zhong\WorkBuddy\2026-11-13-20-55-39\yanfang-app'
ICON = os.path.join(R, 'assets', 'icon')
RES = os.path.join(R, 'app', 'android', 'app', 'src', 'main', 'res')
PAPER = (246, 242, 233)
INK = (58, 40, 28)
INK_SOFT = (138, 112, 88)

FONT_SERIF = r'C:\Windows\Fonts\simsun.ttc'
FONT_SANS = r'C:\Windows\Fonts\msyh.ttc'


def load_font(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except Exception:
        return ImageFont.load_default()


def main():
    base = Image.open(os.path.join(ICON, 'icon-1024.png')).convert('RGBA')
    fg512 = Image.open(os.path.join(ICON, 'adaptive-foreground-432.png')).convert('RGBA')

    dens = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    fgdens = {'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432}

    for name, size in dens.items():
        d = os.path.join(RES, 'mipmap-' + name)
        os.makedirs(d, exist_ok=True)
        base.resize((size, size), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'), optimize=True)
        # 圆形版
        rnd = Image.new('RGBA', (size * 4, size * 4), (0, 0, 0, 0))
        m = Image.new('L', (size * 4, size * 4), 0)
        ImageDraw.Draw(m).ellipse([0, 0, size * 4 - 1, size * 4 - 1], fill=255)
        rnd.paste(base.resize((size * 4, size * 4), Image.LANCZOS), (0, 0), m)
        rnd.resize((size, size), Image.LANCZOS).save(os.path.join(d, 'ic_launcher_round.png'), optimize=True)
        # 自适应前景
        fg512.resize((fgdens[name], fgdens[name]), Image.LANCZOS).save(
            os.path.join(d, 'ic_launcher_foreground.png'), optimize=True)
        print('  mipmap-%s ok (%d / fg %d)' % (name, size, fgdens[name]))

    # 启动标志
    W, H = 1080, 1400
    im = Image.new('RGB', (W, H), PAPER)
    d = ImageDraw.Draw(im)
    logo = base.resize((400, 400), Image.LANCZOS)
    im.paste(logo, ((W - 400) // 2, 380), logo)

    f1 = load_font(FONT_SERIF, 84)
    t1 = '易 圣 验 方'
    bb = d.textbbox((0, 0), t1, font=f1)
    d.text(((W - (bb[2] - bb[0])) // 2 - bb[0], 850), t1, font=f1, fill=INK, stroke_width=1, stroke_fill=INK)

    f2 = load_font(FONT_SANS, 38)
    t2 = '方剂资料检索 · 离线可用'
    bb2 = d.textbbox((0, 0), t2, font=f2)
    d.text(((W - (bb2[2] - bb2[0])) // 2 - bb2[0], 1010), t2, font=f2, fill=INK_SOFT)

    im.save(os.path.join(RES, 'drawable-nodpi', 'splash_logo.png'), optimize=True)
    print('  splash_logo.png ok')

    # 商店素材
    store = os.path.join(R, 'assets', 'store')
    os.makedirs(store, exist_ok=True)
    base.resize((512, 512), Image.LANCZOS).save(os.path.join(store, 'icon-512.png'), optimize=True)
    base.resize((1024, 1024), Image.LANCZOS).save(os.path.join(store, 'icon-1024.png'), optimize=True)
    print('done')


if __name__ == '__main__':
    main()

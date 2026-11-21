# -*- coding: utf-8 -*-
"""
生成商店素材：应用图标 + 5 张 1080×1920 截图（拼接配文）
用法：
  1) 先用 Edge headless 抓 5 张 1080×1640 的裸截图到 上架素材/shot/raw1..5.png
  2) python tools/make-store-assets.py

配文已过禁用词表（不出现 医/诊疗/疗效/服用 等）。
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, '上架素材')
SHOT = os.path.join(OUT, 'shot')

PAPER = '#f6f2e9'
PAPER_2 = '#fffdf8'
INK = '#23201b'
INK_3 = '#918779'
LINE = '#e2d8c6'
CINNABAR = '#b03a2a'
SEAL = '#a8341f'
GOLD = '#96773c'

F_SANS = 'C:/Windows/Fonts/msyh.ttc'
F_SANS_BD = 'C:/Windows/Fonts/msyhbd.ttc'
F_SERIF = 'C:/Windows/Fonts/simsun.ttc'


def font(path, size, index=0):
    try:
        return ImageFont.truetype(path, size, index=index)
    except Exception:
        return ImageFont.load_default()


def centered(draw, text, fnt, cx, y, fill):
    w = draw.textlength(text, font=fnt)
    draw.text((cx - w / 2, y), text, font=fnt, fill=fill)


def make_icon(size=512):
    """朱砂印章式图标：圆角红底 + 细金线 + 宋体「拾」"""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    r = int(size * 0.22)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=SEAL)

    # 内细线，做印章边款的感觉
    inset = int(size * 0.085)
    d.rounded_rectangle([inset, inset, size - 1 - inset, size - 1 - inset],
                        radius=int(r * 0.55), outline=GOLD, width=max(2, size // 128))

    # 「拾」——宋体，纸色
    fnt = font(F_SERIF, int(size * 0.56))
    bbox = d.textbbox((0, 0), '拾', font=fnt)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1] - size * 0.01),
           '拾', font=fnt, fill=PAPER)
    return im


CAPTIONS = [
    ('1', '四种方式，找到一条方剂'),
    ('2', '命中位置，一眼可见'),
    ('3', '药味、剂量、出处，逐项可核'),
    ('4', '从一味药，反查它的出处'),
    ('5', '数据来源与整理说明，写在明处'),
]


def compose(idx, caption):
    raw = Image.open(os.path.join(SHOT, f'raw{idx}.png')).convert('RGB')
    W, H = 1080, 1920
    band = H - raw.height  # 280
    canvas = Image.new('RGB', (W, H), PAPER)
    canvas.paste(raw, (0, 0))

    # 画面底部淡出到纸色，表示「下面还有内容」，也避免半行字被硬切
    fade_h = 120
    fade = Image.new('RGBA', (W, fade_h), (0, 0, 0, 0))
    fd = ImageDraw.Draw(fade)
    for y in range(fade_h):
        a = int(255 * (y / (fade_h - 1)) ** 1.6)
        fd.line([(0, y), (W, y)], fill=(246, 242, 233, a))
    canvas.paste(fade, (0, raw.height - fade_h), fade)

    d = ImageDraw.Draw(canvas)

    # 分界线
    d.line([(0, raw.height), (W, raw.height)], fill=LINE, width=2)

    # 印章小标 + 配文
    f_cap = font(F_SANS_BD, 52)
    f_tag = font(F_SERIF, 30)
    cap_y = raw.height + 34

    # 左侧小印章
    s = 44
    d.rounded_rectangle([96, cap_y - 2, 96 + s, cap_y - 2 + s], radius=9, fill=SEAL)
    tag = '拾'
    tw = d.textlength(tag, font=f_tag)
    d.text((96 + (s - tw) / 2, cap_y + 1), tag, font=f_tag, fill=PAPER)

    d.text((96 + s + 24, cap_y - 8), caption, font=f_cap, fill=INK)

    # 底部细字：一句定位说明
    f_small = font(F_SANS, 22)
    centered(d, '易圣验方 · 方剂资料检索 · 离线可用', f_small, W / 2, H - 46, INK_3)

    out = os.path.join(OUT, f'shot-{idx}.png')
    canvas.save(out, 'PNG')
    return out


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    icon = make_icon(512)
    icon.save(os.path.join(OUT, 'icon-512.png'), 'PNG')
    make_icon(1024).save(os.path.join(OUT, 'icon-1024.png'), 'PNG')
    print('icon-512.png / icon-1024.png 已生成')
    for i, cap in CAPTIONS:
        p = compose(i, cap)
        im = Image.open(p)
        print(os.path.basename(p), im.size)

# -*- coding: utf-8 -*-
"""
把「易圣验方」的新图标写进 Android 工程（图标源在 上架素材/图标方案/）

用法：python tools/apply-icon.py

做的事：
  1. 自适应图标前景 ic_launcher_foreground.png（108dp × 各密度）
     —— 用 A-书封-易圣验方-自适应.png（内容缩到 72%，圆形/方圆遮罩都不切书角）
  2. 旧版兜底图标 ic_launcher.png / ic_launcher_round.png（48dp × 各密度）
  3. 背景色 values/ic_launcher_background.xml
  4. 启动标志 drawable-nodpi/splash_logo.png（供 drawable/splash.xml 居中显示）
  5. 商店素材 上架素材/icon-512.png、icon-1024.png

要改图标，先改 上架素材/图标方案/gen-book-icon.py 生成新 PNG，再跑本脚本。
旧的 tools/make-android-assets.py 已废弃（那套是红底「拾」字印章）。
"""
import os
import shutil
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_DIR = os.path.join(ROOT, '上架素材', '图标方案')
RES = os.path.join(ROOT, 'app', 'android', 'app', 'src', 'main', 'res')

FULL = os.path.join(SRC_DIR, 'A-书封-易圣验方.png')            # 1024 全幅
ADAP = os.path.join(SRC_DIR, 'A-书封-易圣验方-自适应.png')      # 1024，内容 72%
LOGO = os.path.join(SRC_DIR, 'splash-logo-1080x1400.png')
BG_COLOR = '#DCCAA6'

DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def main():
    full = Image.open(FULL).convert('RGB')
    adap = Image.open(ADAP).convert('RGB')

    for name, scale in DENSITIES.items():
        out_dir = os.path.join(RES, 'mipmap-' + name)
        os.makedirs(out_dir, exist_ok=True)

        fg = int(108 * scale)          # 自适应前景图层 108dp
        adap.resize((fg, fg), Image.LANCZOS).save(
            os.path.join(out_dir, 'ic_launcher_foreground.png'))

        legacy = int(48 * scale)       # 传统图标 48dp
        for fn in ('ic_launcher.png', 'ic_launcher_round.png'):
            adap.resize((legacy, legacy), Image.LANCZOS).save(os.path.join(out_dir, fn))

    with open(os.path.join(RES, 'values', 'ic_launcher_background.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
                '    <color name="ic_launcher_background">%s</color>\n</resources>\n' % BG_COLOR)

    nodpi = os.path.join(RES, 'drawable-nodpi')
    os.makedirs(nodpi, exist_ok=True)
    shutil.copy(LOGO, os.path.join(nodpi, 'splash_logo.png'))

    full.resize((512, 512), Image.LANCZOS).save(os.path.join(ROOT, '上架素材', 'icon-512.png'))
    full.save(os.path.join(ROOT, '上架素材', 'icon-1024.png'))

    print('图标已写入；改完记得 npx cap sync android 后重新打包')


if __name__ == '__main__':
    main()

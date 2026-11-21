# -*- coding: utf-8 -*-
"""易圣验方 · 一键出包

用法：python tools/release.py

顺序（少一步就会出"APK 里数据是旧的"这种静默错误）：
  1. 合并转录 out/seg*.json → data/formulas.json
  2. 数据体检 → data/check-report.txt
  3. build-offline.mjs → app/www-offline + dist/易圣验方-离线版
  4. npx cap sync android
  5. gradlew assembleRelease
  6. 拷回 dist/易圣验方-v1.0.0.apk，打印体积与 SHA-256

失败即停，不吞错误。出包后仍需人工核对 check-report.txt 里的待确认项。
"""
import hashlib
import os
import shutil
import subprocess
import sys

R = r'C:\Users\zhong\WorkBuddy\2026-11-13-20-55-39\yanfang-app'
APK_SRC = os.path.join(R, 'app', 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
APK_DST = os.path.join(R, 'dist', '易圣验方-v1.0.0.apk')
ENV = dict(os.environ,
           JAVA_HOME=r'C:\Users\zhong\dev\jdk-21.0.13+9',
           ANDROID_HOME=r'C:\Users\zhong\dev\android-sdk')


def which(name):
    """Windows 上 npx / gradlew 需要带 .cmd，subprocess 不会自动补扩展名。"""
    p = shutil.which(name) or shutil.which(name + '.cmd') or shutil.which(name + '.bat')
    if not p:
        raise SystemExit(f'找不到可执行文件：{name}（检查 PATH）')
    return p


def run(args, cwd=R):
    print('\n>>>', ' '.join(args), '[@', cwd, ']', flush=True)
    subprocess.run(args, cwd=cwd, check=True, env=ENV)


def main():
    run([which('node'), 'tools/merge-transcript.mjs'])
    run([sys.executable, 'tools/check-data.py'])
    run([which('node'), 'tools/build-offline.mjs'])
    run([which('npx'), 'cap', 'sync', 'android'], cwd=os.path.join(R, 'app'))
    # gradlew 不在 PATH，就在 android 工程根目录里
    gradlew = os.path.join(R, 'app', 'android', 'gradlew.bat')
    if not os.path.exists(gradlew):
        raise SystemExit('找不到 gradlew.bat：' + gradlew)
    run([gradlew, 'assembleRelease'], cwd=os.path.join(R, 'app', 'android'))

    if not os.path.exists(APK_SRC):
        raise SystemExit('未找到 APK：' + APK_SRC)
    os.makedirs(os.path.dirname(APK_DST), exist_ok=True)
    with open(APK_SRC, 'rb') as f:
        data = f.read()
    with open(APK_DST, 'wb') as f:
        f.write(data)
    print('\n=== 出包完成 ===')
    print('文件  ', APK_DST)
    print('体积  ', len(data), 'B')
    print('SHA-256', hashlib.sha256(data).hexdigest())
    print('\n下一步：人工看 data/check-report.txt 的待确认项；确认后分发 APK（当前无线上分发渠道）。')


if __name__ == '__main__':
    main()

# -*- coding: utf-8 -*-
"""合并后的数据体检：把转录里可能出问题的地方挑出来，交给人工复核

用法：python tools/check-data.py
读 data/formulas.json，输出 data/check-report.txt 与控制台摘要。
"""
import json
import os
import re
from collections import Counter, defaultdict

R = r'C:\Users\zhong\WorkBuddy\2026-11-13-20-55-39\yanfang-app'
d = json.load(open(os.path.join(R, 'data', 'formulas.json'), encoding='utf-8'))
fs = d['formulas']

alias = d.get('herb_alias', {})
known = set()
for f in fs:
    if f.get('part') in ('碑方', '临证'):
        continue
    for h in f.get('herbs', []):
        if h.get('name'):
            known.add(h['name'])

# 已知药名字表：旧数据里出现过的一切药名（保留原始写法，含炮制前缀）
BASE = set()
for f in fs:
    for h in f.get('herbs', []):
        n = h.get('name', '')
        if n:
            BASE.add(n)
for k in alias:
    BASE.add(k)

problems = []
missing_name = []
bad_dose = []
unknown_herb = Counter()
square = []
dup = Counter()
chapters = defaultdict(set)

for f in fs:
    key = (f.get('part'), f.get('name', '').strip())
    dup[key] += 1
    if not f.get('name', '').strip():
        missing_name.append(f'{f.get("id")} {f.get("source_no")}')
    for h in f.get('herbs', []):
        n = h.get('name', '')
        if not n:
            problems.append(f'{f["id"]} 药名为空')
        elif n not in BASE and not any(k in n for k in ('□', '?')):
            unknown_herb[n] += 1
        dose = h.get('dose', '')
        if dose and not re.match(r'^\d', dose) and not any(
                k in dose for k in ('适量', '各', '～', '少许', '枚', '片', '只', '克', '毫升', '两')):
            bad_dose.append(f'{f["id"]} {n} = {dose}')
        if '□' in json.dumps(h, ensure_ascii=False):
            square.append(f'{f["id"]} {n}')
    for k in ('name', 'doctor', 'functions', 'indications', 'usage'):
        if '□' in str(f.get(k, '')):
            square.append(f'{f["id"]} 字段 {k}')
    if f.get('disease_group'):
        chapters[f.get('part')].add(f['disease_group'])

lines = []
lines.append('易圣验方 · 数据体检报告')
lines.append('=' * 50)
lines.append(f'方剂总数 {len(fs)}，药味行 {sum(len(f.get("herbs", [])) for f in fs)}')
lines.append(f'部分 {len(set(f.get("part") for f in fs))}，'
             f'章（不重复病名）{sum(len(v) for v in chapters.values())}')
lines.append('')
lines.append(f'一、方名缺失 {len(missing_name)} 条')
lines.extend('  ' + x for x in missing_name[:50])
lines.append(f'二、重复键（部分+方名）{sum(1 for v in dup.values() if v > 1)} 组')
for k, v in dup.items():
    if v > 1:
        lines.append(f'  {k[0]} | {k[1]} ×{v}')
lines.append(f'三、剂量写法异常 {len(bad_dose)} 条')
lines.extend('  ' + x for x in bad_dose[:40])
lines.append(f'四、□ 占位 {len(set(square))} 处')
lines.extend('  ' + x for x in sorted(set(square))[:50])
lines.append(f'五、药名不在既有字表 {len(unknown_herb)} 种（新药或 OCR 疑误，需人工分辨）')
for n, c in unknown_herb.most_common(120):
    lines.append(f'  {n} ×{c}')
lines.append(f'六、uncertain 汇总')
cnt = 0
for f in fs:
    u = f.get('uncertain')
    # 旧数据（碑方/临证等另书）里 uncertain 是布尔标记，新转录是字符串数组，统一容错
    if isinstance(u, bool):
        u = ['（旧数据布尔标记：存疑）'] if u else []
    elif isinstance(u, str):
        u = [u]
    elif not isinstance(u, (list, tuple)):
        u = []
    for x in u:
        lines.append(f'  {f["id"]} {f.get("name", "")}: {x}')
        cnt += 1
lines.append(f'  共 {cnt} 条')

txt = '\n'.join(lines) + '\n'
open(os.path.join(R, 'data', 'check-report.txt'), 'w', encoding='utf-8').write(txt)
print('\n'.join(lines[:24]))
print('...')
print('完整报告：data/check-report.txt')

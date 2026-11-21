# 数据说明

## 为什么只有 5 首

仓库里的 `data/formulas.json` 是公开样例：5 首《伤寒论》《金匮要略》古方。这两部书成书近两千年，属公有领域，药量为现代折算，不涉及在版图书版权。

完整库逐页转录自扫描本《首批国家级名老中医效验秘方精选》（正编与续集），转录成果涉及其文字表达，不公开分发。想跑完整数据，把自己的 `formulas.json` 放进 `data/`，再执行：

```bash
node tools/build-data.mjs
node tools/build-offline.mjs
```

## 字段

顶层含 `schema`（结构版本）、`version`（数据版本）、`herb_alias`（药名归并）、`formulas`（方剂数组）。一条方剂的主要字段：

| 字段 | 内容 |
|---|---|
| `name` / `doctor` | 方名、医家 |
| `part` / `category` / `disease_group` | 分部、科别、病名章节 |
| `herbs[]` | `{ raw, name, dose, note }`，逐味可核 |
| `functions` / `indications` / `usage` | 功用、主治、用法 |
| `source` | `{ book, pages }`，标明扫描本版本与书页 |
| `tags` | 从主治、功用按词表抽取 |
| `uncertain` | 辨字存疑、缺栏等校记，不渲染到界面 |

`source_no` 是原书编号，仅供溯源，不作为唯一键。

## 收录边界

只收四栏事实：组成、功效、主治、用法。方解、按语、加减、疗效、病例等论述文字不入库。缺栏留空，不猜；辨不清的字标 `□` 并写入 `uncertain`。

## 两个扫描本

同名书有新旧两版：新扫描本书页 1–476，旧扫描本 1–469。两版方名只重合 5 条，章序也不同，**同一编号在两版里是不同方**，因此不能按 `source_no` 合并。每条数据用 `source.book` 标明出自哪一版，按书页回查时不会对错书。

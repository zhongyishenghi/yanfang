# 易圣验方 · 方剂资料检索

把名老中医方剂资料整理成**可检索的结构化数据**，做成一个完全离线可用的网页 / Android 应用。四类入口：方名、医家、病名、药味；支持拼音首字母与空格多味药反查。

> 这是 `yanfang` 仓库的正式版本，作为全新 APP 独立发布。数据以《首批国家级名老中医效验秘方精选》正编与续集扫描件逐页转录为主体，另附碑方、临证等另书内容；**完整数据不随源码公开**，仓库内 `data/formulas.json` 是 5 首《伤寒论》《金匮要略》古方（公有领域），仅用于演示字段结构与检索行为。详见 [DATA.md](DATA.md)。
>
> 想了解这个软件为什么做、数据怎么整理、代码怎么设计、哪些部分开源，看 [关于这个软件.md](关于这个软件.md)。

## 下载

> **当前暂无公开下载渠道。** 早先的 GitHub Releases 与预览站分发地址均已下线，正式站点重新上线后再补链接。
>
> 想自己构建：见下方「出离线版 / 安卓包」。注意构建需要你自己的 `data/formulas.json`——仓库里只有 5 首古方样例，用来演示 schema 与检索行为。

## 特性

- **四种检索入口**：方名 / 医家 / 病名 / 药味；药味按标准名归并（`herb_alias` 链式归并，别名、炮制与产地前缀写法合并到同一味药）
- **空格多味药反查**：输入「柴胡 黄芩」只出同时含这两味的方子
- **拼音与首字母**：`chaihujiedutang`、`chjd` 都能命中；拼音在构建期生成，运行时零依赖
- **收藏**：存 localStorage，不联网、不上传
- **左滑翻方**：详情页左右滑切换上一条 / 下一条
- **完全离线**：数据以 `window.YANFANG_SEED` 内联进 `js/db.js`，没有 fetch、没有 CDN、没有第三方 SDK；Android 安装包**不申请 `INTERNET` 权限**，系统层面就发不出请求（`build-offline.mjs` 出包时对此有硬断言）
- **纯静态**：无构建期框架、无运行时依赖，`app/www` 目录双击 `index.html` 就能跑

## 快速开始

### 网页版（最快）

```bash
cd app/www
# 双击 index.html 即可，或起个本地服务
python -m http.server 8000
```

### 出离线版 / 安卓包

```bash
node tools/build-data.mjs          # data/formulas.json → app/www/js/db.js（含拼音与索引）
node tools/build-offline.mjs       # → dist/易圣验方-离线版/ 与 app/www-offline/
cd app && npx cap sync android     # 同步进 Android 工程的 assets/public
cd android && ./gradlew.bat assembleRelease
```

构建需要本机 JDK 21 与 Android SDK 35。签名配置不随仓库分发，需自备 keystore。

## 目录结构

```
yanfang/
├── app/
│   ├── www/            开发版（本地双击可看；update.js 仅留作将来的增量更新，不再被页面加载）
│   ├── www-offline/    出包版（由 build-offline.mjs 生成，不要手改）
│   ├── android/        Capacitor 7 的 Android 工程
│   └── capacitor.config.json
├── data/
│   ├── formulas.json   **5 首古方样例**（唯一事实来源的完整版不入库，见 DATA.md）
│   ├── symptom-vocab.json  病名 / 证候词表（标签与病名检索用）
│   └── version.json    在线数据版本清单
├── tools/              构建、导入、转录合并、校验、图标脚本
├── assets/icon/        图标与启动图
└── dist/               出包产物（不入库）
```

`webDir` 是 `www-offline`，不是 `app/www`。改代码或数据永远改 `app/www` 与 `data/`，出包前跑一次 `build-offline.mjs` 即可。

## 数据口径

- **主体**：《首批国家级名老中医效验秘方精选》正编与续集扫描件逐页转录。只收〔组成〕〔功效〕〔主治〕〔用法〕四个事实栏目；〔方解〕〔按语〕〔加减〕〔疗效〕〔典型病例〕等论述文字一律不入库。
- **两批资料是同名书的不同版本**：本版来自 2026 年新扫描本（书页 1–476），另有早年扫描本（书页 1–469）。两版章序与方名不同，`source.book` 明确标注版本，避免按页码核对时对错书。
- **另书**：碑方（袁淑芳墓碑验方百首）、临证用方等，按 `part` 字段区分，不与原书编号混淆。
- **编号**：`source_no` 照抄原书编号（如 `32.15`）；各部分编号都从 1 起，且两版编号含义不同，所以唯一键是「部分 + 方名 + 医家」，**不能只看编号**。
- **页码**：扫描件有缺页与倒置页，`pages` 字段按扫描顺序推定，与原书印刷页码可能相差 1–4 页；正文内容不受影响。
- **校记**：辨字存疑、原书重号、缺栏等写在条目的 `uncertain` 里，随包分发但前台不渲染。体检报告由 `tools/check-data.py` 生成（不入库）。
- **药名**：保留炮制前缀（`炙甘草`、`炒白术`），常见简称归并为通行名（`元胡`→`延胡索`、`云苓`→`茯苓`），归并表在 `data/formulas.json` 的 `herb_alias`。

## 联网与隐私

应用完全不联网：资料全部内置，检索与阅读全程在本机完成，不做版本检查、不统计装机量，也不请求任何服务器。

收藏只存在本机，清除浏览器数据或卸载即消失。Android 安装包不申请任何敏感权限（`dumpsys package` 里查不到 `android.permission` 条目），`INTERNET` 已于 1.0.7 移除。

> 历史：1.0.6 及更早版本曾在启动时读一次版本清单并携带本机随机编号用于装机统计，该功能与其服务端已于 2026-11-20 整体下线。

## 版本与签名

- 包名 `vip.zhongyisheng.yanfang`，versionName `1.0.7`，versionCode `8`，minSdk 23 / targetSdk 35
- 发布证书 `yanfang-release.jks`（**不要提交到公开仓库**），需自备
- 应用图标：赭石渐变底 + 米白药罐与蒸汽 + 内缩金线，与启动页、页头小标同源（`assets/gen_icon.py` 可重出）

## 许可

代码开源（MIT），数据为文献整理成果，**完整数据不随源码分发**——仓库内 `data/formulas.json` 与 `app/www/data/formulas.json` 均只有 5 首公有领域古方。把自己的 `formulas.json` 放进 `data/` 后重跑 `node tools/build-data.mjs` 即可换成完整库。理由与字段口径见 [DATA.md](DATA.md)。

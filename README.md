# 易圣验方

离线方剂检索工具。按方名、医家、病名、药味查方，支持拼音首字/全拼，以及空格多味药反查（输入「柴胡 黄芩」只出同时含两味的方）。双击 `app/www/index.html` 即可用，也能装到安卓手机。

## 仓库里有什么

代码和整理后的数据都在这里：2086 首方、18575 条药味，与 App 内置数据一致。其中 805 首验秘方逐页转录自《首批国家级名老中医效验秘方精选》正编与续集等文献；1281 首药典方（`id` 以 `yd-` 开头）取自《中华人民共和国药典》的成方制剂与单味制剂（以 2025 年版为主），处方剂量以克为单位。只收录方名、组成用量、功能、主治、用法五类事实字段。详见 [DATA.md](DATA.md) 和 [关于这个软件.md](关于这个软件.md)。

当前版本 1.0.7（versionCode 8），包名 `vip.zhongyisheng.yanfang`。

## 运行与构建

```bash
# 网页版：双击 app/www/index.html，或起个本地服务
cd app/www && python -m http.server 8000

# 从源码出包
node tools/build-data.mjs       # data/formulas.json → app/www/js/db.js
node tools/build-offline.mjs    # → dist/易圣验方-离线版/（发布包）
cd app && npx cap sync android
cd android && ./gradlew.bat assembleRelease
```

构建需要 JDK 21、Android SDK 35。签名证书自备，不随仓库分发。

改代码和数据只改 `app/www`、`data/`。`app/www-offline`、`dist/` 是生成物。

## 联网与隐私

应用完全离线：数据内置，无账号、无统计、无版本检查，安卓包不申请 `INTERNET` 权限。收藏只存本机。仓库开发版里的 `update.js` 是未启用的历史脚本，出包时被剥离。

## 许可

代码 MIT。数据为文献整理成果，一并公开；原始扫描页不在仓库内。

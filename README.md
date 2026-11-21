# 易圣验方

离线方剂检索工具。按方名、医家、病名、药味查方，支持拼音首字/全拼，以及空格多味药反查（输入「柴胡 黄芩」只出同时含两味的方）。双击 `app/www/index.html` 即可用，也能装到安卓手机。

## 仓库里有什么

代码全部公开（MIT）。数据只有 5 首《伤寒论》《金匮要略》古方，用来演示字段结构和检索效果——两书成书近两千年，属公有领域。完整库逐页转录自在版扫描书，不随源码分发。详见 [DATA.md](DATA.md) 和 [关于这个软件.md](关于这个软件.md)。

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

代码 MIT。数据不在许可范围内，完整数据不公开，理由见 [关于这个软件.md](关于这个软件.md)。

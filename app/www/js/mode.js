/* 易圣验方 · 运行模式
 *
 * 离线版（默认）：数据全部内置在安装包里，不联网、不请求任何外部接口。
 * 需要「填网址增量同步」时，把 online 改成 true 并确保 index.html 里加载了 js/update.js。
 *
 * 2026-11-20 起不再有「对照原页」图片入口，来源栏只显示书名与页码。
 */
window.YANFANG_MODE = {
  online: false
};

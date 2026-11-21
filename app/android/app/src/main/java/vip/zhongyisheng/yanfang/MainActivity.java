package vip.zhongyisheng.yanfang;

import android.webkit.ValueCallback;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * 物理返回键先交给网页处理：详情页收回列表、其它页签回到检索，都消化掉；
     * 网页返回 exit 时才真正退出应用，避免看方子时误按返回直接关掉 APP。
     */
    @Override
    public void onBackPressed() {
        Bridge bridge = getBridge();
        WebView webView = bridge != null ? bridge.getWebView() : null;
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        webView.evaluateJavascript(
                "window.__yanfangBack ? window.__yanfangBack() : 'exit'",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value == null || value.contains("exit")) {
                            finish();
                        }
                    }
                });
    }
}

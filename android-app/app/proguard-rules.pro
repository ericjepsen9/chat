# EMAS Push SDK
-keep class com.alibaba.sdk.android.push.** { *; }
-keep class com.taobao.** { *; }
-keep class com.ut.** { *; }
-dontwarn com.alibaba.sdk.android.push.**
-dontwarn com.taobao.**

# WebView JS bridge
-keepclassmembers class com.mychat.app.bridge.NativeBridge {
    @android.webkit.JavascriptInterface <methods>;
}

# Keep app classes
-keep class com.mychat.app.** { *; }

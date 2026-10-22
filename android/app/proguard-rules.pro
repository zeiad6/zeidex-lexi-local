# The page calls these by name through addJavascriptInterface.
-keepclassmembers class com.zeidexsoft.lexilocal.Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

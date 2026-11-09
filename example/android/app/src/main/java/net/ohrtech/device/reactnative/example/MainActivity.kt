package net.ohrtech.device.reactnative.example

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {
  override fun getMainComponentName(): String = "DeviceSdkReactNativeExample"

  // `am start … --es route /checks/<name>?…`: the device checks instead of the sample (an initial prop).
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        override fun getLaunchOptions(): Bundle = Bundle().apply { putString("route", intent?.getStringExtra("route") ?: "") }
      }
}

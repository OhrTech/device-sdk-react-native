package net.ohrtech.device.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.viewmanagers.OhrWifiViewManagerDelegate
import com.facebook.react.viewmanagers.OhrWifiViewManagerInterface
import net.ohrtech.device.OhrWifiView
import org.json.JSONObject

/** The Agent's Wi-Fi screen as a Fabric component: theme and options as JSON props, its events as onConnected/onWifiError. */
@ReactModule(name = OhrWifiViewManager.NAME)
class OhrWifiViewManager : SimpleViewManager<OhrWifiView>(), OhrWifiViewManagerInterface<OhrWifiView> {
    private val delegate: ViewManagerDelegate<OhrWifiView> = OhrWifiViewManagerDelegate(this)

    override fun getDelegate(): ViewManagerDelegate<OhrWifiView> = delegate

    override fun getName() = NAME

    override fun createViewInstance(context: ThemedReactContext): OhrWifiView = OhrWifiView(context).apply {
        listener = object : OhrWifiView.Listener {
            override fun onConnected(ssid: String) =
                dispatch(context, this@apply, "topConnected", Arguments.createMap().apply { putString("ssid", ssid) })

            override fun onError(error: Exception) {
                val p = error.parts()
                dispatch(context, this@apply, "topWifiError", Arguments.createMap().apply {
                    putString("code", p.code)
                    putString("message", p.message)
                    putString("detailsJson", p.details.toString())
                })
            }
        }
    }

    @ReactProp(name = "themeJson")
    override fun setThemeJson(view: OhrWifiView, value: String?) {
        val m = value?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()
        fun color(n: String) = if (m.has(n) && !m.isNull(n)) m.getLong(n).toInt() else null
        view.theme = OhrWifiView.Theme(
            if (m.has("dark") && !m.isNull("dark")) m.getBoolean("dark") else null,
            color("accent"), color("background"), color("text"),
            if (m.has("cornerRadius") && !m.isNull("cornerRadius")) m.getDouble("cornerRadius").toFloat() else null,
        )
    }

    @ReactProp(name = "optionsJson")
    override fun setOptionsJson(view: OhrWifiView, value: String?) {
        val m = value?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()
        view.options = OhrWifiView.Options(
            m.optBoolean("wifiSwitch", true), m.optBoolean("addNetwork", true), m.optBoolean("enterprise", true),
            m.optBoolean("forget", true), m.optBoolean("saved", true),
        )
    }

    override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> = mapOf(
        "topConnected" to mapOf("registrationName" to "onConnected"),
        "topWifiError" to mapOf("registrationName" to "onWifiError"),
    )

    private fun dispatch(context: ReactContext, view: OhrWifiView, name: String, data: WritableMap) {
        val surface = UIManagerHelper.getSurfaceId(context)
        UIManagerHelper.getEventDispatcherForReactTag(context, view.id)
            ?.dispatchEvent(ViewEvent(surface, view.id, name, data))
    }

    private class ViewEvent(surfaceId: Int, viewId: Int, private val name: String, private val data: WritableMap) :
        Event<ViewEvent>(surfaceId, viewId) {
        override fun getEventName() = name
        override fun getEventData(): WritableMap = data
    }

    companion object {
        const val NAME = "OhrWifiView"
    }
}

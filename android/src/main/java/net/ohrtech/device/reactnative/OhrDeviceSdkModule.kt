package net.ohrtech.device.reactnative

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import net.ohrtech.device.OhrCertificates
import net.ohrtech.device.OhrConfig
import net.ohrtech.device.OhrDeviceSdk
import net.ohrtech.device.OhrKiosk
import net.ohrtech.device.OhrListener
import net.ohrtech.device.OhrNetwork
import net.ohrtech.device.OhrPower
import net.ohrtech.device.OhrSettings
import net.ohrtech.device.OhrUpdates
import net.ohrtech.device.OhrUsb
import net.ohrtech.device.OhrWifi
import org.json.JSONArray
import org.json.JSONObject
import java.io.Closeable
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * The OhrTech Device SDK for React Native: the TypeScript API's Android side, over the Kotlin library
 * (net.ohrtech:device-sdk). Calls run on a pool of worker threads; changes come as onEvent.
 */
@ReactModule(name = OhrDeviceSdkModule.NAME)
class OhrDeviceSdkModule(context: ReactApplicationContext) : NativeOhrDeviceSdkSpec(context) {
    private val methods = Methods { reactApplicationContext.currentActivity }
    private val watches = ConcurrentHashMap<String, Closeable>()

    init {
        OhrDeviceSdk.init(context)
    }

    override fun getName() = NAME

    override fun call(method: String, argsJson: String, promise: Promise) {
        workers.execute {
            try {
                promise.resolve(methods.call(method, argsJson))
            } catch (e: Throwable) {
                val p = e.parts()
                promise.reject(p.code, p.message, Arguments.makeNativeMap(mapOf("detailsJson" to p.details.toString())))
            }
        }
    }

    override fun beat(timeoutMs: Double) {
        runCatching { OhrKiosk.beat(timeoutMs.toLong()) }
    }

    /** The kinds of change and how to subscribe to each: listen(executor, listener) and the value as JSON. */
    private val kinds: Map<String, (Executor, (String) -> Unit) -> Closeable> = mapOf(
        "connection" to { e, send ->
            val now = OhrDeviceSdk.connection.value.name
            e.execute { send(JSONObject.quote(now)) }
            OhrDeviceSdk.listenConnection(e) { send(JSONObject.quote(it.name)) }
        },
        "updates" to { e, send -> OhrUpdates.listen(e) { send(it.json().toString()) } },
        "wifiState" to { e, send -> OhrWifi.listenState(e) { send(it.json().toString()) } },
        "wifiNetworks" to { e, send -> OhrWifi.listenNetworks(e) { n -> send(JSONArray(n.map { it.json }).toString()) } },
        "networkState" to { e, send -> OhrNetwork.listen(e) { send(it.json().toString()) } },
        "kioskMode" to { e, send -> OhrKiosk.listenMode(e) { send(JSONObject.quote(it)) } },
        "battery" to { e, send -> OhrPower.listenBattery(e) { send(it.json().toString()) } },
        "settings" to { e, send -> OhrSettings.listen(e) { send(it.json().toString()) } },
        "config" to { e, send -> OhrConfig.listen(e) { send(it.json().toString()) } },
        "certificates" to { e, send -> OhrCertificates.listen(e, OhrListener { send("true") }) },
        "usb" to { e, send -> OhrUsb.listen(e) { c -> send(JSONObject().put("attached", c.attached).put("device", c.device.json()).toString()) } },
    )

    override fun watch(kind: String) {
        val subscribe = kinds[kind] ?: return
        workers.execute {
            if (watches.containsKey(kind)) return@execute
            try {
                watches[kind] = subscribe(events) { json -> emit(kind, json) }
            } catch (e: Throwable) {
                val p = e.parts()
                emit("error", JSONObject().put("kind", kind).put("code", p.code).put("message", p.message).put("details", p.details).toString())
            }
        }
    }

    override fun unwatch(kind: String) {
        workers.execute { watches.remove(kind)?.let { runCatching { it.close() } } }
    }

    private fun emit(kind: String, json: String) {
        emitOnEvent(Arguments.createMap().apply {
            putString("kind", kind)
            putString("json", json)
        })
    }

    override fun invalidate() {
        watches.values.forEach { runCatching { it.close() } }
        watches.clear()
        super.invalidate()
    }

    companion object {
        const val NAME = "OhrDeviceSdk"
        private val workers: ExecutorService = Executors.newCachedThreadPool { r -> Thread(r, "OhrDeviceSdk-rn").apply { isDaemon = true } }

        /** Events in order, off the binder threads. */
        private val events: Executor = Executors.newSingleThreadExecutor { r -> Thread(r, "OhrDeviceSdk-events").apply { isDaemon = true } }
    }
}

package net.ohrtech.device.reactnative

import android.app.Activity
import android.os.Bundle
import net.ohrtech.device.OhrAccess
import net.ohrtech.device.OhrAttestation
import net.ohrtech.device.OhrCertificates
import net.ohrtech.device.OhrConfig
import net.ohrtech.device.OhrDevice
import net.ohrtech.device.OhrDeviceSdk
import net.ohrtech.device.OhrDiagnostics
import net.ohrtech.device.OhrException
import net.ohrtech.device.OhrKiosk
import net.ohrtech.device.OhrNetwork
import net.ohrtech.device.OhrPower
import net.ohrtech.device.OhrSettings
import net.ohrtech.device.OhrUpdates
import net.ohrtech.device.OhrUsb
import net.ohrtech.device.OhrWifi
import net.ohrtech.device.keys.OhrKeys
import net.ohrtech.device.push.OhrPush
import net.ohrtech.device.push.OhrPushMessage
import net.ohrtech.device.push.PushToken
import net.ohrtech.device.push.SenderKey
import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONTokener
import java.util.Base64

/**
 * The TypeScript API's methods, by name: each takes its arguments as a JSON object and returns a JSON
 * value (or null). They run on a worker thread; errors are [OhrException]s.
 */
internal class Methods(private val activity: () -> Activity?) {
    private val table: Map<String, (JSONObject) -> Any?> = mapOf(
        // The connection and access
        "connect" to { a -> OhrDeviceSdk.connectBlocking(a.optLong("timeoutMs", 10_000)); null },
        "isAvailable" to { _ -> OhrDeviceSdk.isAvailable() },
        "connectionState" to { _ -> OhrDeviceSdk.connection.value.name },
        "accessInfo" to { _ -> OhrAccess.info().json() },

        // Device and updates
        "deviceInfo" to { _ -> OhrDevice.info().json() },
        "updatesAvailable" to { _ -> OhrUpdates.available()?.json() },
        "updatesInstall" to { a -> OhrUpdates.install(a.optBoolean("whenIdle")); null },

        // Wi-Fi (configs and networks as the Agent's JSON)
        "wifiState" to { _ -> OhrWifi.state().json() },
        "wifiNetworks" to { _ -> JSONArray(OhrWifi.networks().map { it.json }) },
        "wifiScan" to { _ -> OhrWifi.scan(); null },
        "wifiSaved" to { _ -> JSONArray(OhrWifi.saved()) },
        "wifiSave" to { a -> OhrWifi.save(a.obj("config")) },
        "wifiConnect" to { a -> OhrWifi.connect(a.str("keyOrIdentity")); null },
        "wifiConnectConfig" to { a -> OhrWifi.connect(a.obj("config")) },
        "wifiDisconnect" to { _ -> OhrWifi.disconnect(); null },
        "wifiForget" to { a -> OhrWifi.forget(a.str("identity")); null },
        "wifiSetEnabled" to { a -> OhrWifi.setEnabled(a.getBoolean("on")); null },
        "wifiConnectQr" to { a -> OhrWifi.connectQr(a.str("text")) },

        // Network
        "networkState" to { _ -> OhrNetwork.state().json() },
        "networkSetMobileData" to { a -> OhrNetwork.setMobileData(a.getBoolean("on")); null },
        "networkSetAirplaneMode" to { a -> OhrNetwork.setAirplaneMode(a.getBoolean("on")); null },
        "networkSetDataRoaming" to { a -> OhrNetwork.setDataRoaming(a.getBoolean("on")); null },

        // Kiosk
        "kioskStart" to { a ->
            val act = activity() ?: throw OhrException.Failed("kiosk mode needs the app's activity, and there is none now")
            OhrKiosk.start(act, a.optInt("features", OhrKiosk.Feature.GLOBAL_ACTIONS or OhrKiosk.Feature.SYSTEM_INFO))
            null
        },
        "kioskStop" to { _ -> OhrKiosk.stop(); null },
        "kioskState" to { _ -> OhrKiosk.state().let { JSONObject().put("pinned", it.pinned).put("mode", it.mode).put("features", it.features).put("appMayExit", it.appMayExit) } },
        "kioskRequestExit" to { _ -> OhrKiosk.requestExit(); null },
        "kioskStopHeartbeat" to { _ -> OhrKiosk.stopHeartbeat(); null },

        // Power
        "powerBattery" to { _ -> OhrPower.battery().json() },
        "powerReboot" to { a -> OhrPower.reboot(a.str("reason")); null },
        "powerScheduleReboot" to { a ->
            OhrPower.scheduleReboot(a.optJSONObject("schedule")?.let { s ->
                val d = s.getJSONArray("days")
                OhrPower.Schedule(s.getString("time"), (0 until d.length()).map { d.getInt(it) }.toSet(), s.optString("reason"))
            })
            null
        },
        "powerRebootSchedule" to { _ -> OhrPower.rebootSchedule()?.let { JSONObject().put("time", it.time).put("days", JSONArray(it.days.sorted())).put("reason", it.reason) } },
        "powerSetScreenTimeout" to { a -> OhrPower.setScreenTimeout(a.getInt("seconds")); null },
        "powerSetBrightness" to { a -> OhrPower.setBrightness(a.getInt("percent")); null },

        // Settings
        "settingsKeys" to { _ -> JSONArray(OhrSettings.keys()) },
        "settingsGet" to { a -> OhrSettings.get(a.str("key")).json() },
        "settingsSet" to { a -> OhrSettings.set(a.str("key"), a.opt("value").takeUnless { it == JSONObject.NULL }); null },

        // Managed configuration
        "configValues" to { _ -> OhrConfig.values().json() },
        "configString" to { a -> OhrConfig.string(a.str("key"), a.optString("fallback").takeIf { a.has("fallback") && !a.isNull("fallback") }) },
        "configInt" to { a -> OhrConfig.int(a.str("key"), a.optInt("fallback")) },
        "configBool" to { a -> OhrConfig.bool(a.str("key"), a.optBoolean("fallback")) },
        "configStrings" to { a -> JSONArray(OhrConfig.strings(a.str("key"))) },
        "configIsSet" to { a -> OhrConfig.isSet(a.str("key")) },

        // Attestation
        "attestationAttest" to { a ->
            val suite = when (a.optString("suite", "ec")) {
                "ec" -> OhrAttestation.Suite.EC
                "ec-mldsa65" -> OhrAttestation.Suite.EC_MLDSA65
                else -> throw OhrException.InvalidConfig("suite", "ec or ec-mldsa65")
            }
            OhrAttestation.attest(a.bytes("challenge"), suite).toJson()
        },
        "attestationToken" to { a -> OhrAttestation.token(a.str("audience"), a.optLong("ttlSeconds", 300), a.optString("nonce").takeIf { a.has("nonce") && !a.isNull("nonce") }) },
        "attestationSuite" to { _ -> OhrAttestation.suite?.let { it.name.lowercase().replace('_', '-') } },

        // Certificates
        "certificatesCanRequest" to { _ -> OhrCertificates.canRequest() },
        "certificatesRequest" to { a -> OhrCertificates.request(a.str("alias"), a.optLong("timeoutMs", 60_000)).json().also { Http.forget() } },
        "certificatesRenewIfDue" to { a -> OhrCertificates.renewIfDue(a.str("alias"))?.json()?.also { Http.forget() } },
        "certificatesList" to { _ -> JSONArray(OhrCertificates.list().map { it.json() }) },
        "httpSend" to { a -> Http.send(a) },

        // USB
        "usbDevices" to { _ -> JSONArray(OhrUsb.devices().map { it.json() }) },

        // Diagnostics
        "diagnosticsEvent" to { a -> OhrDiagnostics.event(a.str("name"), a.optJSONObject("data") ?: JSONObject()); null },
        "diagnosticsLog" to { a -> OhrDiagnostics.log(a.getInt("priority"), a.str("tag"), a.str("message")); null },

        // Keys
        "keysIsAvailable" to { _ -> OhrKeys.isAvailable() },
        "keysGenerate" to { a -> b64(OhrKeys.generate(a.str("alias"), OhrKeys.Algorithm.named(a.str("algorithm")))) },
        "keysList" to { _ -> JSONArray(OhrKeys.list().map { JSONObject().put("alias", it.alias).put("algorithm", it.algorithm.standardName).put("createdAtMs", it.createdAtMs) }) },
        "keysPublicKey" to { a -> OhrKeys.publicKey(a.str("alias"))?.let(::b64) },
        "keysDelete" to { a -> OhrKeys.delete(a.str("alias")); null },
        "keysDecapsulate" to { a -> b64(OhrKeys.decapsulate(a.str("alias"), a.bytes("ciphertext"))) },
        "keysEncapsulate" to { a ->
            OhrKeys.encapsulate(OhrKeys.Algorithm.named(a.str("algorithm")), a.bytes("publicKey"))
                .let { JSONObject().put("ciphertext", b64(it.ciphertext)).put("sharedSecret", b64(it.sharedSecret)) }
        },
        "keysHpkeOpen" to { a ->
            b64(OhrKeys.hpkeOpen(a.str("alias"), a.optInt("kdf", 1), a.optInt("aead", 1), a.bytes("enc"), a.bytesOr("info"), a.bytesOr("aad"), a.bytes("ciphertext")))
        },
        "keysAttest" to { a ->
            OhrKeys.attest(a.str("alias"), a.bytes("challenge")).let {
                JSONObject().put("algorithm", it.algorithm.standardName).put("publicKey", b64(it.publicKey)).put("owner", it.owner)
                    .put("coseSign1", b64(it.coseSign1)).put("diceChain", b64(it.diceChain))
            }
        },

        // Push
        "pushRegister" to { a ->
            val suite = OhrPush.Suite.named(a.optString("suite", "x25519")) ?: throw OhrException.InvalidConfig("suite", "x25519 or xwing-mldsa65")
            OhrPush.register(senderKeys(a.getJSONArray("senderKeys")), suite).json()
        },
        "pushToken" to { _ -> OhrPush.token()?.json() },
        "pushUnregister" to { _ -> OhrPush.unregister(); null },
        "pushSetSenderKeys" to { a -> OhrPush.setSenderKeys(senderKeys(a.getJSONArray("keys"))); null },
        "pushSenderKeys" to { _ -> JSONArray(OhrPush.senderKeys().map { k -> JSONObject().put("ed25519", b64(k.ed25519)).apply { k.mlDsa65?.let { put("mlDsa65", b64(it)) } } }) },
    )

    /** Runs [method]; the result as JSON text. */
    fun call(method: String, argsJson: String): String {
        val f = table[method] ?: throw OhrException.Unsupported("this version of the module has no method $method")
        val args = try {
            if (argsJson.isBlank()) JSONObject() else JSONObject(argsJson)
        } catch (e: org.json.JSONException) {
            throw OhrException.InvalidConfig("args", "not a JSON object")
        }
        val result = try {
            f(args)
        } catch (e: org.json.JSONException) {
            throw OhrException.InvalidConfig("args", e.message ?: "missing or wrong argument")
        }
        return jsonText(result)
    }

    private fun senderKeys(a: JSONArray) = (0 until a.length()).map { i ->
        val k = a.getJSONObject(i)
        SenderKey(unb64(k.getString("ed25519")), k.optString("mlDsa65").takeIf { k.has("mlDsa65") && !k.isNull("mlDsa65") }?.let(::unb64))
    }
}

internal fun b64(b: ByteArray): String = Base64.getEncoder().encodeToString(b)
internal fun unb64(s: String): ByteArray = try {
    Base64.getDecoder().decode(s)
} catch (e: IllegalArgumentException) {
    throw OhrException.InvalidConfig("base64", "not base64")
}

private fun JSONObject.str(name: String): String = getString(name)
private fun JSONObject.obj(name: String): JSONObject = getJSONObject(name)
private fun JSONObject.bytes(name: String): ByteArray = unb64(getString(name))
private fun JSONObject.bytesOr(name: String): ByteArray = if (has(name) && !isNull(name)) unb64(getString(name)) else ByteArray(0)

/** A value as JSON text: null, a string, a number, a boolean, an array or an object. */
internal fun jsonText(value: Any?): String = when (value) {
    null, JSONObject.NULL -> "null"
    is String -> JSONObject.quote(value)
    else -> JSONObject.wrap(value).toString()
}

internal fun parseJson(text: String): Any? = JSONTokener(text).nextValue().takeUnless { it == JSONObject.NULL }

internal fun OhrAccess.Info.json() = JSONObject().put("app", app).put("packageName", packageName).put("appVersion", appVersion ?: JSONObject.NULL)
    .put("areas", JSONArray(areas.sorted())).put("agentVersion", agentVersion).put("agentInterface", agentInterface)

internal fun OhrDevice.Info.json(): JSONObject {
    fun named(n: OhrDevice.Named?) = n?.let { JSONObject().put("id", it.id).put("name", it.name) } ?: JSONObject.NULL
    return JSONObject().put("deviceId", deviceId ?: JSONObject.NULL).put("serial", serial ?: JSONObject.NULL).put("fleet", named(fleet))
        .put("org", named(org)).put("osRelease", osRelease).put("osBuild", osBuild).put("securityPatch", securityPatch)
        .put("osIncremental", osIncremental).put("agentVersion", agentVersion).put("online", online)
}

internal fun OhrUpdates.Update.json() = JSONObject().put("versionCode", versionCode).put("versionName", versionName ?: JSONObject.NULL)
    .put("notes", notes ?: JSONObject.NULL).put("downloaded", downloaded)

internal fun OhrWifi.State.json() = JSONObject().put("enabled", enabled).put("state", state).put("connected", connected ?: JSONObject.NULL)

internal fun OhrNetwork.State.json() = JSONObject()
    .put("active", active?.let { JSONObject().put("transport", it.transport).put("validated", it.validated).put("captive", it.captive).put("metered", it.metered).put("vpn", it.vpn) } ?: JSONObject.NULL)
    .put("mobileData", mobileData).put("airplaneMode", airplaneMode).put("dataRoaming", dataRoaming).put("ethernetConnected", ethernetConnected)

internal fun OhrPower.Battery.json() = JSONObject().put("level", level ?: JSONObject.NULL).put("charging", charging)
    .put("plugged", plugged ?: JSONObject.NULL).put("health", health).put("temperatureC", temperatureC).put("screenOn", screenOn)

internal fun OhrSettings.Setting.json() = JSONObject().put("key", key).put("value", value ?: JSONObject.NULL).put("mode", mode)

internal fun OhrCertificates.Certificate.json() = JSONObject().put("alias", alias).put("imported", imported)
    .put("paths", JSONArray(paths.map { p -> JSONArray(p.map { b64(it.encoded) }) }))

internal fun OhrUsb.Device.json() = JSONObject().put("accessory", accessory).put("deviceName", deviceName ?: JSONObject.NULL)
    .put("vendorId", vendorId).put("productId", productId).put("manufacturer", manufacturer ?: JSONObject.NULL)
    .put("product", product ?: JSONObject.NULL).put("model", model ?: JSONObject.NULL).put("version", version ?: JSONObject.NULL)
    .put("serial", serial ?: JSONObject.NULL).put("name", name ?: JSONObject.NULL).put("hasPermission", hasPermission)

internal fun PushToken.json() = JSONObject().put("token", token).put("suite", suite.wireName).put("publicKey", publicKeyBase64)

internal fun OhrPushMessage.json() = JSONObject().put("id", id).put("data", b64(data)).put("expiresAtMs", expiresAtMs)
    .put("highPriority", highPriority).put("pushId", pushId)

/** Managed configuration as JSON: bundles as objects, bundle arrays as lists. */
@Suppress("DEPRECATION")
internal fun Bundle.json(): JSONObject = JSONObject().also { o ->
    for (k in keySet().sorted()) {
        o.put(k, when (val v = get(k)) {
            is Bundle -> v.json()
            is Array<*> -> JSONArray(v.map { if (it is Bundle) it.json() else it })
            null -> JSONObject.NULL
            else -> v
        })
    }
}

/** [OhrException] (or anything else) as the code, message and details the TypeScript side reads. */
internal data class ErrorParts(val code: String, val message: String, val details: JSONObject)

internal fun Throwable.parts(): ErrorParts = when (this) {
    is OhrException.NotManaged -> ErrorParts("NotManaged", message ?: "", JSONObject())
    is OhrException.NotAllowed -> ErrorParts("NotAllowed", message ?: "", JSONObject().put("area", area))
    is OhrException.FleetLocked -> ErrorParts("FleetLocked", message ?: "", JSONObject().put("key", key))
    is OhrException.Unsupported -> ErrorParts("Unsupported", message ?: "", JSONObject().put("reason", reason).put("needsAgent", needsAgent ?: JSONObject.NULL))
    is OhrException.InvalidConfig -> ErrorParts("InvalidConfig", message ?: "", JSONObject().put("field", field).put("reason", reason))
    is OhrException.Refused -> ErrorParts("Refused", message ?: "", JSONObject().put("reason", reason))
    is OhrException.Failed -> ErrorParts("Failed", message ?: "", JSONObject().put("reason", reason))
    else -> (message ?: toString()).let { ErrorParts("Failed", it, JSONObject().put("reason", it)) }
}

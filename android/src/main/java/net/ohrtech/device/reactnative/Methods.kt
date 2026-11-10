package net.ohrtech.device.reactnative

import android.app.Activity
import android.os.Bundle
import net.ohrtech.device.json.OhrJsonApi
import net.ohrtech.device.push.OhrPushMessage
import net.ohrtech.device.push.PushToken
import org.json.JSONObject
import org.json.JSONTokener
import java.io.Closeable
import java.util.Base64
import java.util.concurrent.Executor

/**
 * The TypeScript API's methods and changes: the library's JSON API (net.ohrtech.device.json.OhrJsonApi, which the web
 * app shell shares), and what only this module does: HTTP with the app's client certificate (httpSend, and the TLS
 * cache a new certificate empties) and push delivery receipts (pushDone). Methods run on a worker thread; errors are
 * OhrExceptions.
 */
internal class Methods(activity: () -> Activity?) {
    private val base = OhrJsonApi(activity)
    private val api = OhrJsonApi(activity, mapOf(
        "certificatesRequest" to OhrJsonApi.Method("certificates") { a ->
            parseJson(base.call("certificatesRequest", a.toString())).also { Http.forget() }
        },
        "certificatesRenewIfDue" to OhrJsonApi.Method("certificates") { a ->
            parseJson(base.call("certificatesRenewIfDue", a.toString())).also { Http.forget() }
        },
        "httpSend" to OhrJsonApi.Method(null) { a -> Http.send(a) },
        "pushDone" to OhrJsonApi.Method("push") { a ->
            OhrDevicePushService.done(a.getString("delivery"), a.optString("failed").takeIf { a.has("failed") && !a.isNull("failed") })
            null
        },
    ))

    /** Runs [method]; the result as JSON text. */
    fun call(method: String, argsJson: String): String = api.call(method, argsJson)

    val kinds: Set<String> get() = api.kinds

    /** Each change of [kind] as JSON text, on [executor], until closed. */
    fun watch(kind: String, executor: Executor, send: (String) -> Unit): Closeable = api.watch(kind, executor, send)
}

internal fun b64(b: ByteArray): String = Base64.getEncoder().encodeToString(b)
internal fun unb64(s: String): ByteArray = try {
    Base64.getDecoder().decode(s)
} catch (e: IllegalArgumentException) {
    throw net.ohrtech.device.OhrException.InvalidConfig("base64", "not base64")
}

/** A value as JSON text: null, a string, a number, a boolean, an array or an object. */
internal fun jsonText(value: Any?): String = OhrJsonApi.jsonText(value)

internal fun parseJson(text: String): Any? = JSONTokener(text).nextValue().takeUnless { it == JSONObject.NULL }

internal fun PushToken.json() = JSONObject().put("token", token).put("suite", suite.wireName).put("publicKey", publicKeyBase64)

internal fun OhrPushMessage.json() = JSONObject().put("id", id).put("data", b64(data)).put("expiresAtMs", expiresAtMs)
    .put("highPriority", highPriority).put("pushId", pushId)

/** [net.ohrtech.device.OhrException] (or anything else) as the code, message and details the TypeScript side reads. */
internal data class ErrorParts(val code: String, val message: String, val details: JSONObject)

internal fun Throwable.parts(): ErrorParts =
    OhrJsonApi.error(this).let { ErrorParts(it.getString("code"), it.getString("message"), it.getJSONObject("details")) }

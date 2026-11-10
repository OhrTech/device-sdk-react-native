package net.ohrtech.device.reactnative

import net.ohrtech.device.OhrCertificates
import net.ohrtech.device.OhrException
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLSocketFactory

/**
 * HTTP through Android's own stack, with the app's client certificate and trusted CAs: the keys live in
 * the Android Keystore, which JavaScript's fetch can't reach. Bodies (base64) are sent and read whole.
 */
internal object Http {
    private class Entry(val factory: SSLSocketFactory, val madeAt: Long)

    private val factories = ConcurrentHashMap<String, Entry>()
    private const val KEEP_MS = 5 * 60_000L

    /** The certificates changed (a request or renewal): build the TLS context again. */
    fun forget() = factories.clear()

    /** The fleet's changes too (trusted CAs, bundles), from the first use; with an Agent before 1061, five minutes. */
    @Volatile
    private var watching: java.io.Closeable? = null

    private fun watch() {
        if (watching != null) return
        synchronized(this) {
            if (watching == null) {
                watching = try {
                    OhrCertificates.listen({ it.run() }) { forget() }
                } catch (e: OhrException) {
                    java.io.Closeable { }
                }
            }
        }
    }

    private fun factory(alias: String?): SSLSocketFactory {
        watch()
        val key = alias ?: ""
        val now = System.currentTimeMillis()
        factories[key]?.takeIf { now - it.madeAt < KEEP_MS }?.let { return it.factory }
        return OhrCertificates.sslContext(alias).socketFactory.also { factories[key] = Entry(it, now) }
    }

    /** {method, url, headers, body?, alias?, timeoutMs, followRedirects} to {status, reason, headers, body, url}. */
    fun send(r: JSONObject): JSONObject {
        val method = r.optString("method", "GET")
        val target = r.getString("url")
        val url = try {
            URL(target)
        } catch (e: Exception) {
            throw OhrException.InvalidConfig("url", e.message ?: "not a URL")
        }
        val alias = r.optString("alias").takeIf { r.has("alias") && !r.isNull("alias") }
        val timeout = r.optInt("timeoutMs", 30_000)
        val c = url.openConnection() as HttpURLConnection
        try {
            if (c is HttpsURLConnection) c.sslSocketFactory = factory(alias)
            c.requestMethod = method
            c.instanceFollowRedirects = r.optBoolean("followRedirects", true)
            c.connectTimeout = timeout
            c.readTimeout = timeout
            r.optJSONObject("headers")?.let { h -> h.keys().forEach { k -> c.setRequestProperty(k, h.getString(k)) } }
            if (r.has("body") && !r.isNull("body")) {
                val body = unb64(r.getString("body"))
                if (body.isNotEmpty()) {
                    c.doOutput = true
                    c.setFixedLengthStreamingMode(body.size)
                    c.outputStream.use { it.write(body) }
                }
            }
            val status = c.responseCode
            val stream = if (status >= 400) c.errorStream else c.inputStream
            val body = stream?.use { it.readBytes() } ?: ByteArray(0)
            val headers = JSONObject()
            c.headerFields.forEach { (k, v) -> if (k != null) headers.put(k.lowercase(), v.joinToString(", ")) }
            return JSONObject().put("status", status).put("reason", c.responseMessage ?: JSONObject.NULL).put("headers", headers)
                .put("body", b64(body)).put("url", c.url.toString())
        } catch (e: IOException) {
            throw OhrException.Failed("HTTP $method $target: ${e.message ?: e}")
        } finally {
            c.disconnect()
        }
    }
}

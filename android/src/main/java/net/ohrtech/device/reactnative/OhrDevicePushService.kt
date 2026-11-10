package net.ohrtech.device.reactnative

import android.os.Handler
import android.os.Looper
import android.util.Log
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import net.ohrtech.device.push.OhrPushMessage
import net.ohrtech.device.push.OhrPushService
import net.ohrtech.device.push.PushToken
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * The module's push service (declared in its manifest): the library checks and opens each message, then
 * the app's headless JS task "OhrDevicePush" (OhrPush.setHandlers) runs, React Native started for it if the
 * app isn't open. It runs inside this service, which the Agent has bound, and the service waits for the
 * task (up to [TASK_MS]) so the process stays up while it works.
 */
class OhrDevicePushService : OhrPushService() {
    /** A message the app's handler didn't take is reported to the hub as dropped (see [run]'s reasons). */
    override fun onMessage(message: OhrPushMessage) {
        run("message", message.json())?.let { throw NotHandled(it) }
    }

    override fun onTokenChanged(token: PushToken?) {
        run("token", JSONObject().put("token", token?.json() ?: JSONObject.NULL))
    }

    override fun onDropped(pushId: String, reason: String) {
        run("dropped", JSONObject().put("pushId", pushId).put("reason", reason))
    }

    private val main = Handler(Looper.getMainLooper())

    /**
     * Runs the app's task and waits for it. Null when its handler ran, else why not: "no_engine" (React Native
     * didn't start), "no_handler" (no OhrPush.setHandlers at the entry point), "handler_timeout", or "handler" (it threw).
     */
    private fun run(kind: String, data: JSONObject): String? {
        val host = (application as? ReactApplication)?.reactHost
        if (host == null) {
            Log.e(TAG, "Push $kind: the app isn't a ReactApplication with a ReactHost")
            return "no_engine"
        }
        val context = AtomicReference<ReactContext?>()
        val started = CountDownLatch(1)
        main.post {
            host.currentReactContext?.let {
                context.set(it)
                started.countDown()
                return@post
            }
            host.addReactInstanceEventListener(object : ReactInstanceEventListener {
                override fun onReactContextInitialized(c: ReactContext) {
                    host.removeReactInstanceEventListener(this)
                    context.set(c)
                    started.countDown()
                }
            })
            host.start()
        }
        if (!started.await(TASK_MS, TimeUnit.MILLISECONDS)) {
            Log.e(TAG, "Push $kind: React Native didn't start in time")
            return "no_engine"
        }
        val c = context.get() ?: return "no_engine"
        val delivery = java.util.UUID.randomUUID().toString()
        val done = CountDownLatch(1)
        main.post {
            try {
                val tasks = HeadlessJsTaskContext.getInstance(c)
                val args = Arguments.createMap().apply {
                    putString("kind", kind)
                    putString("json", data.toString())
                    putString("delivery", delivery)
                }
                val config = HeadlessJsTaskConfig(TASK, args, TASK_MS, isAllowedInForeground = true)
                var id = -1
                tasks.addTaskEventListener(object : HeadlessJsTaskEventListener {
                    override fun onHeadlessJsTaskStart(taskId: Int) {}
                    override fun onHeadlessJsTaskFinish(taskId: Int) {
                        if (taskId != id) return
                        tasks.removeTaskEventListener(this)
                        done.countDown()
                    }
                })
                id = tasks.startTask(config)
            } catch (e: Exception) {
                // No task registered: the app didn't call OhrPush.setHandlers at its entry point.
                Log.e(TAG, "Push $kind: couldn't start the app's handler (OhrPush.setHandlers in index.js?)", e)
                done.countDown()
            }
        }
        val finished = done.await(TASK_MS + 2_000, TimeUnit.MILLISECONDS)
        // The task reports its outcome ([done]); finishing without one means no task of ours ran.
        val outcome = RESULTS.remove(delivery)
        return when {
            outcome != null -> outcome.ifEmpty { null }
            !finished -> "handler_timeout".also { Log.w(TAG, "Push $kind: the handler took longer than ${TASK_MS / 1000} s") }
            else -> "no_handler".also { Log.e(TAG, "Push $kind: no handler ran (OhrPush.setHandlers in index.js?)") }
        }
    }

    internal companion object {
        private const val TAG = "OhrDevicePush"
        private const val TASK = "OhrDevicePush"
        private const val TASK_MS = 25_000L
        private val RESULTS = java.util.concurrent.ConcurrentHashMap<String, String>()

        /** The app's task ran: [failed] is null, or why its handler didn't take the delivery. */
        fun done(delivery: String, failed: String?) {
            RESULTS[delivery] = failed ?: ""
        }
    }
}

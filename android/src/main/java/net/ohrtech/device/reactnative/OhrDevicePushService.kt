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
    override fun onMessage(message: OhrPushMessage) = run("message", message.json())

    override fun onTokenChanged(token: PushToken?) = run("token", JSONObject().put("token", token?.json() ?: JSONObject.NULL))

    override fun onDropped(pushId: String, reason: String) = run("dropped", JSONObject().put("pushId", pushId).put("reason", reason))

    private val main = Handler(Looper.getMainLooper())

    private fun run(kind: String, data: JSONObject) {
        val host = (application as? ReactApplication)?.reactHost
        if (host == null) {
            Log.e(TAG, "Push $kind: the app isn't a ReactApplication with a ReactHost")
            return
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
            return
        }
        val c = context.get() ?: return
        val done = CountDownLatch(1)
        main.post {
            try {
                val tasks = HeadlessJsTaskContext.getInstance(c)
                val args = Arguments.createMap().apply {
                    putString("kind", kind)
                    putString("json", data.toString())
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
        if (!done.await(TASK_MS + 2_000, TimeUnit.MILLISECONDS)) Log.w(TAG, "Push $kind: the handler took longer than ${TASK_MS / 1000} s")
    }

    private companion object {
        const val TAG = "OhrDevicePush"
        const val TASK = "OhrDevicePush"
        const val TASK_MS = 25_000L
    }
}

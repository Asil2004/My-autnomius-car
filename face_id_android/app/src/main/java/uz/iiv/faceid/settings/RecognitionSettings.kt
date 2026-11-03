package uz.iiv.faceid.settings

import android.content.Context
import android.content.SharedPreferences

class RecognitionSettings(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("qalqon_face_prefs", Context.MODE_PRIVATE)

    var threshold: Float
        get() = prefs.getFloat(KEY_THRESHOLD, 0.65f)
        set(value) = prefs.edit().putFloat(KEY_THRESHOLD, value).apply()

    var isLivenessEnabled: Boolean
        get() = prefs.getBoolean(KEY_LIVENESS, true)
        set(value) = prefs.edit().putBoolean(KEY_LIVENESS, value).apply()

    var throttleIntervalMs: Long
        get() = prefs.getLong(KEY_THROTTLE, 200L)
        set(value) = prefs.edit().putLong(KEY_THROTTLE, value).apply()

    var adminPin: String
        get() = prefs.getString(KEY_ADMIN_PIN, "102102") ?: "102102"
        set(value) = prefs.edit().putString(KEY_ADMIN_PIN, value).apply()

    companion object {
        private const val KEY_THRESHOLD = "rec_threshold"
        private const val KEY_LIVENESS = "rec_liveness"
        private const val KEY_THROTTLE = "rec_throttle"
        private const val KEY_ADMIN_PIN = "admin_pin"
    }
}

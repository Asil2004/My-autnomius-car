package uz.iiv.faceid.database

import androidx.room.TypeConverter

class FloatArrayConverter {
    @TypeConverter
    fun fromFloatArray(array: FloatArray?): String? {
        if (array == null) return null
        val sb = StringBuilder(array.size * 9)
        for (i in array.indices) {
            sb.append(array[i])
            if (i < array.size - 1) sb.append(",")
        }
        return sb.toString()
    }

    @TypeConverter
    fun toFloatArray(str: String?): FloatArray? {
        if (str.isNullOrEmpty()) return null
        val parts = str.split(",")
        val result = FloatArray(parts.size)
        for (i in parts.indices) {
            result[i] = parts[i].toFloatOrNull() ?: 0.0f
        }
        return result
    }
}

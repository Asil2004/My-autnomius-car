package uz.iiv.faceid.database

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "registered_faces")
data class FaceEntity(
    @PrimaryKey(autoGenerate = true)
    val id: Long = 0,
    val fullName: String,
    val role: String = "Xodim",
    val imagePath: String? = null,
    val embedding: FloatArray,
    val createdAt: Long = System.currentTimeMillis()
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (javaClass != other?.javaClass) return false
        other as FaceEntity
        if (id != other.id) return false
        if (fullName != other.fullName) return false
        if (!embedding.contentEquals(other.embedding)) return false
        return true
    }

    override fun hashCode(): Int {
        var result = id.hashCode()
        result = 31 * result + fullName.hashCode()
        result = 31 * result + embedding.contentHashCode()
        return result
    }
}

package uz.iiv.faceid.registration

import android.content.Context
import android.graphics.Bitmap
import uz.iiv.faceid.database.AppDatabase
import uz.iiv.faceid.database.FaceEntity
import uz.iiv.faceid.embedding.FaceEmbeddingModel
import java.io.File
import java.io.FileOutputStream
import java.util.UUID
import kotlin.math.sqrt

class FaceRegistrar(
    private val context: Context,
    private val embeddingModel: FaceEmbeddingModel
) {
    private val db = AppDatabase.getInstance(context)

    /**
     * Registers a new face from a list of captured face bitmaps (1 or more for multi-pose averaging).
     */
    suspend fun registerPerson(
        fullName: String,
        role: String,
        faceBitmaps: List<Bitmap>
    ): FaceEntity {
        require(faceBitmaps.isNotEmpty()) { "Kamida bitta yuz rasmi kerak" }

        // 1. Compute embeddings and average them for multi-pose robustness
        val embeddings = faceBitmaps.map { embeddingModel.getEmbedding(it) }
        val dim = embeddingModel.embeddingDim
        val avgEmbedding = FloatArray(dim)

        for (emb in embeddings) {
            for (i in 0 until dim) {
                avgEmbedding[i] += emb[i]
            }
        }

        // L2-normalize the averaged vector
        val count = embeddings.size.toFloat()
        var sumSq = 0.0f
        for (i in 0 until dim) {
            avgEmbedding[i] = avgEmbedding[i] / count
            sumSq += avgEmbedding[i] * avgEmbedding[i]
        }
        val norm = sqrt(sumSq)
        if (norm > 0) {
            for (i in 0 until dim) {
                avgEmbedding[i] = avgEmbedding[i] / norm
            }
        }

        // 2. Save representative photo locally
        val imagePath = saveFaceImage(faceBitmaps.first())

        // 3. Persist to Room Database
        val entity = FaceEntity(
            fullName = fullName.trim(),
            role = role.trim(),
            imagePath = imagePath,
            embedding = avgEmbedding,
            createdAt = System.currentTimeMillis()
        )

        val newId = db.faceDao().insert(entity)
        return entity.copy(id = newId)
    }

    private fun saveFaceImage(bitmap: Bitmap): String {
        val facesDir = File(context.filesDir, "registered_faces")
        if (!facesDir.exists()) facesDir.mkdirs()

        val file = File(facesDir, "face_${UUID.randomUUID()}.jpg")
        FileOutputStream(file).use { out ->
            bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
        }
        return file.absolutePath
    }
}

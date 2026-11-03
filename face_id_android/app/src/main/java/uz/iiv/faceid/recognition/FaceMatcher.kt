package uz.iiv.faceid.recognition

import android.graphics.Rect
import uz.iiv.faceid.database.FaceEntity
import uz.iiv.faceid.security.LivenessResult
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt

class FaceMatcher {

    /**
     * Cosine similarity between two L2-normalized 192-d vectors.
     * Normalized dot product: values range from -1.0 to +1.0.
     * Realistic face matches typically score > 0.65 - 0.75.
     */
    fun computeCosineSimilarity(a: FloatArray, b: FloatArray): Float {
        if (a.size != b.size) return 0.0f
        var dot = 0.0f
        for (i in a.indices) {
            dot += a[i] * b[i]
        }
        return min(1.0f, max(-1.0f, dot))
    }

    /**
     * Euclidean distance: d(a,b) = sqrt(sum((a_i - b_i)^2))
     */
    fun computeEuclideanDistance(a: FloatArray, b: FloatArray): Float {
        if (a.size != b.size) return Float.MAX_VALUE
        var sum = 0.0f
        for (i in a.indices) {
            val diff = a[i] - b[i]
            sum += diff * diff
        }
        return sqrt(sum)
    }

    /**
     * Evaluates query embedding against all registered entities in local database.
     */
    fun match(
        queryEmbedding: FloatArray,
        databaseFaces: List<FaceEntity>,
        threshold: Float,
        boundingBox: Rect,
        livenessResult: LivenessResult? = null
    ): RecognitionResult {
        if (databaseFaces.isEmpty()) {
            return RecognitionResult(
                matchedPerson = null,
                similarity = 0.0f,
                distance = 2.0f,
                isUnknown = true,
                livenessResult = livenessResult,
                boundingBox = boundingBox
            )
        }

        var bestMatch: FaceEntity? = null
        var maxSimilarity = -1.0f
        var minDistance = Float.MAX_VALUE

        for (candidate in databaseFaces) {
            val similarity = computeCosineSimilarity(queryEmbedding, candidate.embedding)
            val distance = computeEuclideanDistance(queryEmbedding, candidate.embedding)

            if (similarity > maxSimilarity) {
                maxSimilarity = similarity
                minDistance = distance
                bestMatch = candidate
            }
        }

        val isUnknown = maxSimilarity < threshold || bestMatch == null

        return RecognitionResult(
            matchedPerson = if (isUnknown) null else bestMatch,
            similarity = max(0.0f, maxSimilarity),
            distance = minDistance,
            isUnknown = isUnknown,
            livenessResult = livenessResult,
            boundingBox = boundingBox
        )
    }
}

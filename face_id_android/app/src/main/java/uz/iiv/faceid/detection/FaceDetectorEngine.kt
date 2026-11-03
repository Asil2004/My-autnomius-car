package uz.iiv.faceid.detection

import android.graphics.Bitmap
import android.graphics.Rect
import com.google.android.gms.tasks.Task
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.Face
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetector
import com.google.mlkit.vision.face.FaceDetectorOptions
import kotlin.math.max
import kotlin.math.min

class FaceDetectorEngine {

    private val detector: FaceDetector

    init {
        val options = FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setLandmarkMode(FaceDetectorOptions.LANDMARK_MODE_ALL)
            .setClassificationMode(FaceDetectorOptions.CLASSIFICATION_MODE_ALL)
            .setMinFaceSize(0.15f)
            .build()
        detector = FaceDetection.getClient(options)
    }

    fun detectInImage(image: InputImage): Task<List<Face>> {
        return detector.process(image)
    }

    /**
     * Safely crops a detected face from the source bitmap with an optional margin.
     */
    fun cropFace(sourceBitmap: Bitmap, face: Face, marginPercent: Float = 0.10f): Bitmap? {
        val box = face.boundingBox
        val width = sourceBitmap.width
        val height = sourceBitmap.height

        val marginX = (box.width() * marginPercent).toInt()
        val marginY = (box.height() * marginPercent).toInt()

        val left = max(0, box.left - marginX)
        val top = max(0, box.top - marginY)
        val right = min(width, box.right + marginX)
        val bottom = min(height, box.bottom + marginY)

        val cropWidth = right - left
        val cropHeight = bottom - top

        if (cropWidth <= 0 || cropHeight <= 0) return null

        return Bitmap.createBitmap(sourceBitmap, left, top, cropWidth, cropHeight)
    }

    fun close() {
        detector.close()
    }
}

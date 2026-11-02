package uz.iiv.faceid

import android.app.Application
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import com.google.android.gms.tasks.Tasks
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import uz.iiv.faceid.database.AppDatabase
import uz.iiv.faceid.database.FaceEntity
import uz.iiv.faceid.embedding.FaceEmbeddingModel
import uz.iiv.faceid.settings.RecognitionSettings
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import kotlin.math.max
import kotlin.math.min

class FaceIdApp : Application() {

    lateinit var embeddingModel: FaceEmbeddingModel
        private set

    lateinit var settings: RecognitionSettings
        private set

    override fun onCreate() {
        super.onCreate()
        instance = this

        settings = RecognitionSettings(this)
        embeddingModel = FaceEmbeddingModel(this, numThreads = 4)

        // Seed initial database asynchronously if empty
        CoroutineScope(Dispatchers.IO).launch {
            seedPreloadedFacesIfNeeded()
        }
    }

    private suspend fun seedPreloadedFacesIfNeeded() {
        val db = AppDatabase.getInstance(this)
        val count = db.faceDao().getCount()
        if (count > 0) {
            Log.d(TAG, "Database already seeded with $count faces.")
            return
        }

        Log.d(TAG, "Seeding initial database with official officers...")

        val initialMembers = listOf(
            Triple("preload/koldoshev_sarvar.jpg", "Qo'ldoshev Sarvar", "IIV Xodimi"),
            Triple("preload/asilbek_ravshanov.png", "Asilbek Ravshanov", "Tizim Muhandisi"),
            Triple("preload/boburjon_bozorov.jpg", "Bozorov Boburjon", "Katta Ilmiy Xodim")
        )

        val detector = FaceDetection.getClient(
            FaceDetectorOptions.Builder()
                .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_ACCURATE)
                .build()
        )

        val facesDir = File(filesDir, "registered_faces")
        if (!facesDir.exists()) facesDir.mkdirs()

        for ((assetPath, name, role) in initialMembers) {
            try {
                val inputStream: InputStream = assets.open(assetPath)
                val bitmap = BitmapFactory.decodeStream(inputStream)
                inputStream.close()

                if (bitmap != null) {
                    val inputImage = InputImage.fromBitmap(bitmap, 0)
                    val detectedFaces = Tasks.await(detector.process(inputImage))

                    val faceBitmap = if (detectedFaces.isNotEmpty()) {
                        val box = detectedFaces[0].boundingBox
                        val marginX = (box.width() * 0.10f).toInt()
                        val marginY = (box.height() * 0.10f).toInt()
                        val l = max(0, box.left - marginX)
                        val t = max(0, box.top - marginY)
                        val w = min(bitmap.width - l, box.width() + marginX * 2)
                        val h = min(bitmap.height - t, box.height() + marginY * 2)
                        Bitmap.createBitmap(bitmap, l, t, w, h)
                    } else {
                        bitmap
                    }

                    // Compute MobileFaceNet 192-d embedding
                    val embedding = embeddingModel.getEmbedding(faceBitmap)

                    // Save local image file
                    val safeFileName = "face_${name.replace("'", "").replace(" ", "_").lowercase()}.jpg"
                    val file = File(facesDir, safeFileName)
                    FileOutputStream(file).use { out ->
                        faceBitmap.compress(Bitmap.CompressFormat.JPEG, 90, out)
                    }

                    val entity = FaceEntity(
                        fullName = name,
                        role = role,
                        imagePath = file.absolutePath,
                        embedding = embedding,
                        createdAt = System.currentTimeMillis()
                    )
                    db.faceDao().insert(entity)
                    Log.d(TAG, "Successfully seeded face for: $name")
                }
            } catch (e: Exception) {
                Log.e(TAG, "Failed to preload $name from $assetPath", e)
            }
        }
        detector.close()
    }

    override fun onTrimMemory(level: Int) {
        super.onTrimMemory(level)
    }

    companion object {
        private const val TAG = "FaceIdApp"
        lateinit var instance: FaceIdApp
            private set
    }
}

package uz.iiv.faceid.ui.add

import android.graphics.Bitmap
import android.os.Bundle
import android.util.Size
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.google.mlkit.vision.common.InputImage
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import uz.iiv.faceid.FaceIdApp
import uz.iiv.faceid.camera.BitmapUtils
import uz.iiv.faceid.databinding.ActivityAddPersonBinding
import uz.iiv.faceid.detection.FaceDetectorEngine
import uz.iiv.faceid.registration.FaceRegistrar
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class AddPersonActivity : AppCompatActivity() {

    private lateinit var binding: ActivityAddPersonBinding
    private lateinit var cameraExecutor: ExecutorService
    private lateinit var faceRegistrar: FaceRegistrar
    private val faceDetector = FaceDetectorEngine()

    private var latestFaceBitmap: Bitmap? = null
    private val lensFacing = CameraSelector.LENS_FACING_FRONT

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityAddPersonBinding.inflate(layoutInflater)
        setContentView(binding.root)

        cameraExecutor = Executors.newSingleThreadExecutor()
        faceRegistrar = FaceRegistrar(this, FaceIdApp.instance.embeddingModel)

        binding.btnCancel.setOnClickListener {
            finish()
        }

        binding.btnCaptureAndSave.setOnClickListener {
            savePerson()
        }

        startCamera()
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder().build().also {
                it.setSurfaceProvider(binding.previewViewAdd.surfaceProvider)
            }

            val imageAnalysis = ImageAnalysis.Builder()
                .setTargetResolution(Size(640, 480))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()

            imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                val mediaImage = imageProxy.image
                if (mediaImage == null) {
                    imageProxy.close()
                    return@setAnalyzer
                }

                val inputImage = InputImage.fromMediaImage(mediaImage, imageProxy.imageInfo.rotationDegrees)
                faceDetector.detectInImage(inputImage)
                    .addOnSuccessListener { faces ->
                        if (faces.isNotEmpty()) {
                            val face = faces[0]
                            val fullBitmap = try {
                                BitmapUtils.imageProxyToRotatedBitmap(imageProxy)
                            } catch (e: Exception) {
                                null
                            }

                            if (fullBitmap != null) {
                                val cropped = faceDetector.cropFace(fullBitmap, face)
                                fullBitmap.recycle()
                                synchronized(this) {
                                    latestFaceBitmap?.recycle()
                                    latestFaceBitmap = cropped
                                }

                                runOnUiThread {
                                    binding.tvQualityStatus.text = "Holat: ✅ Yuz aniqlandi (${face.boundingBox.width()}x${face.boundingBox.height()})"
                                    binding.tvQualityStatus.setTextColor(getColor(uz.iiv.faceid.R.color.tactical_green))
                                }
                            }
                        } else {
                            runOnUiThread {
                                binding.tvQualityStatus.text = "Holat: ⚠️ Yuz qidirilmoqda..."
                                binding.tvQualityStatus.setTextColor(getColor(uz.iiv.faceid.R.color.tactical_amber))
                            }
                        }
                        imageProxy.close()
                    }
                    .addOnFailureListener {
                        imageProxy.close()
                    }
            }

            val cameraSelector = CameraSelector.Builder()
                .requireLensFacing(lensFacing)
                .build()

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageAnalysis)
            } catch (e: Exception) {
                Toast.makeText(this, "Kamerani ochishda xatolik", Toast.LENGTH_SHORT).show()
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun savePerson() {
        val fullName = binding.etFullName.text.toString().trim()
        val role = binding.etRole.text.toString().trim().ifEmpty { "Xodim" }

        if (fullName.isEmpty()) {
            binding.etFullName.error = "Ism va familiyani kiriting!"
            return
        }

        val bitmapToSave: Bitmap?
        synchronized(this) {
            bitmapToSave = latestFaceBitmap?.copy(Bitmap.Config.ARGB_8888, false)
        }

        if (bitmapToSave == null) {
            Toast.makeText(this, "Yuz aniqlanmadi! Kamera qarshisida to'g'ri turing.", Toast.LENGTH_SHORT).show()
            return
        }

        binding.btnCaptureAndSave.isEnabled = false
        binding.tvQualityStatus.text = "Biometrik vektor generatsiya qilinmoqda..."

        lifecycleScope.launch(Dispatchers.IO) {
            try {
                faceRegistrar.registerPerson(
                    fullName = fullName,
                    role = role,
                    faceBitmaps = listOf(bitmapToSave)
                )

                withContext(Dispatchers.Main) {
                    Toast.makeText(this@AddPersonActivity, "Muvaffaqiyatli saqlandi: $fullName", Toast.LENGTH_SHORT).show()
                    finish()
                }
            } catch (e: Exception) {
                withContext(Dispatchers.Main) {
                    binding.btnCaptureAndSave.isEnabled = true
                    Toast.makeText(this@AddPersonActivity, "Xatolik: ${e.message}", Toast.LENGTH_LONG).show()
                }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
        faceDetector.close()
        synchronized(this) {
            latestFaceBitmap?.recycle()
            latestFaceBitmap = null
        }
    }
}

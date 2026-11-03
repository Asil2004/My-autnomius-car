package uz.iiv.faceid.ui.main

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
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
import uz.iiv.faceid.database.AppDatabase
import uz.iiv.faceid.database.FaceEntity
import uz.iiv.faceid.databinding.ActivityMainBinding
import uz.iiv.faceid.detection.FaceDetectorEngine
import uz.iiv.faceid.recognition.FaceMatcher
import uz.iiv.faceid.recognition.RecognitionResult
import uz.iiv.faceid.security.LivenessDetector
import uz.iiv.faceid.ui.admin.AdminLoginActivity
import uz.iiv.faceid.ui.list.RegisteredPeopleActivity
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var cameraExecutor: ExecutorService

    private val faceDetector = FaceDetectorEngine()
    private val faceMatcher = FaceMatcher()
    private val livenessDetector = LivenessDetector()

    private var cachedFaces: List<FaceEntity> = emptyList()
    private var lastAnalyzedTimestamp = 0L
    private val lensFacing = CameraSelector.LENS_FACING_FRONT

    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            startCamera()
        } else {
            Toast.makeText(this, "Kamera ruxsati berilmadi!", Toast.LENGTH_LONG).show()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        cameraExecutor = Executors.newSingleThreadExecutor()

        setupButtons()
        loadDatabaseFaces()

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
            == PackageManager.PERMISSION_GRANTED
        ) {
            startCamera()
        } else {
            requestPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    override fun onResume() {
        super.onResume()
        loadDatabaseFaces()
        livenessDetector.reset()
    }

    private fun setupButtons() {
        binding.btnAddPerson.setOnClickListener {
            val intent = Intent(this, AdminLoginActivity::class.java).apply {
                putExtra("TARGET_SCREEN", "ADD_PERSON")
            }
            startActivity(intent)
        }

        binding.btnRegisteredList.setOnClickListener {
            startActivity(Intent(this, RegisteredPeopleActivity::class.java))
        }

        binding.btnSettings.setOnClickListener {
            val intent = Intent(this, AdminLoginActivity::class.java).apply {
                putExtra("TARGET_SCREEN", "SETTINGS")
            }
            startActivity(intent)
        }
    }

    private fun loadDatabaseFaces() {
        lifecycleScope.launch(Dispatchers.IO) {
            val faces = AppDatabase.getInstance(applicationContext).faceDao().getAll()
            cachedFaces = faces
            withContext(Dispatchers.Main) {
                updateStatsHeader(0, 0L)
            }
        }
    }

    private fun startCamera() {
        val cameraProviderFuture = ProcessCameraProvider.getInstance(this)
        cameraProviderFuture.addListener({
            val cameraProvider = cameraProviderFuture.get()

            val preview = Preview.Builder()
                .build()
                .also {
                    it.setSurfaceProvider(binding.previewView.surfaceProvider)
                }

            val imageAnalysis = ImageAnalysis.Builder()
                .setTargetResolution(Size(640, 480))
                .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                .build()

            imageAnalysis.setAnalyzer(cameraExecutor) { imageProxy ->
                val currentTimestamp = SystemClock.elapsedRealtime()
                val throttleMs = FaceIdApp.instance.settings.throttleIntervalMs

                if (currentTimestamp - lastAnalyzedTimestamp < throttleMs) {
                    imageProxy.close()
                    return@setAnalyzer
                }
                lastAnalyzedTimestamp = currentTimestamp

                processImageFrame(imageProxy)
            }

            val cameraSelector = CameraSelector.Builder()
                .requireLensFacing(lensFacing)
                .build()

            try {
                cameraProvider.unbindAll()
                cameraProvider.bindToLifecycle(this, cameraSelector, preview, imageAnalysis)
            } catch (exc: Exception) {
                Log.e(TAG, "CameraX binding failed", exc)
            }
        }, ContextCompat.getMainExecutor(this))
    }

    private fun processImageFrame(imageProxy: androidx.camera.core.ImageProxy) {
        val startTime = SystemClock.elapsedRealtime()
        val rotationDegrees = imageProxy.imageInfo.rotationDegrees

        val mediaImage = imageProxy.image
        if (mediaImage == null) {
            imageProxy.close()
            return
        }

        val inputImage = InputImage.fromMediaImage(mediaImage, rotationDegrees)

        faceDetector.detectInImage(inputImage)
            .addOnSuccessListener { faces ->
                if (faces.isEmpty()) {
                    binding.overlayView.clear()
                    runOnUiThread {
                        binding.tvRecognitionStatus.text = "🔍 SKANERLANMOQDA..."
                        binding.tvRecognitionStatus.setTextColor(getColor(uz.iiv.faceid.R.color.text_secondary))
                        updateStatsHeader(0, SystemClock.elapsedRealtime() - startTime)
                    }
                    imageProxy.close()
                    return@addOnSuccessListener
                }

                // Convert frame to rotated bitmap for face cropping
                val fullFrameBitmap: Bitmap = try {
                    BitmapUtils.imageProxyToRotatedBitmap(imageProxy)
                } catch (e: Exception) {
                    imageProxy.close()
                    return@addOnSuccessListener
                }

                val recognitionResults = mutableListOf<RecognitionResult>()
                val appSettings = FaceIdApp.instance.settings
                val embeddingModel = FaceIdApp.instance.embeddingModel

                for (face in faces) {
                    val croppedFace = faceDetector.cropFace(fullFrameBitmap, face) ?: continue

                    // Generate MobileFaceNet 192-d normalized embedding
                    val embedding = embeddingModel.getEmbedding(croppedFace)
                    croppedFace.recycle()

                    // Optional Liveness Evaluation
                    val livenessResult = if (appSettings.isLivenessEnabled) {
                        livenessDetector.evaluate(face)
                    } else null

                    // Biometric Top-1 Matching
                    val matchResult = faceMatcher.match(
                        queryEmbedding = embedding,
                        databaseFaces = cachedFaces,
                        threshold = appSettings.threshold,
                        boundingBox = face.boundingBox,
                        livenessResult = livenessResult
                    )
                    recognitionResults.add(matchResult)
                }

                fullFrameBitmap.recycle()

                val inferTimeMs = SystemClock.elapsedRealtime() - startTime

                // Deliver to Overlay and HUD UI
                runOnUiThread {
                    binding.overlayView.setResults(
                        recognitionResults,
                        imageProxy.width,
                        imageProxy.height,
                        lensFacing
                    )

                    updateHud(recognitionResults)
                    updateStatsHeader(faces.size, inferTimeMs)
                }

                imageProxy.close()
            }
            .addOnFailureListener { e ->
                Log.e(TAG, "Face detection error", e)
                imageProxy.close()
            }
    }

    private fun updateHud(results: List<RecognitionResult>) {
        if (results.isEmpty()) {
            binding.tvRecognitionStatus.text = "🔍 SKANERLANMOQDA..."
            binding.tvRecognitionStatus.setTextColor(getColor(uz.iiv.faceid.R.color.text_secondary))
            return
        }

        val top = results.first()
        val isSpoof = top.livenessResult != null && !top.livenessResult.isLive

        when {
            isSpoof -> {
                binding.tvRecognitionStatus.text = "⚠️ SOXTA / STATIK FOTO ANIQLANDI!"
                binding.tvRecognitionStatus.setTextColor(getColor(uz.iiv.faceid.R.color.tactical_red))
            }
            !top.isUnknown && top.matchedPerson != null -> {
                val percent = (top.similarity * 100).toInt()
                binding.tvRecognitionStatus.text = "✅ ${top.matchedPerson.fullName} (${top.matchedPerson.role}) - $percent%"
                binding.tvRecognitionStatus.setTextColor(getColor(uz.iiv.faceid.R.color.tactical_green))
            }
            else -> {
                val percent = (top.similarity * 100).toInt()
                binding.tvRecognitionStatus.text = "👤 NOMA'LUM SHAXS (PIYODA) - $percent%"
                binding.tvRecognitionStatus.setTextColor(getColor(uz.iiv.faceid.R.color.tactical_amber))
            }
        }
    }

    private fun updateStatsHeader(detectedFacesCount: Int, inferTimeMs: Long) {
        val dbCount = cachedFaces.size
        binding.tvStats.text = "INFER: ${inferTimeMs}ms | YUZLAR: $detectedFacesCount | BAZA: $dbCount"
    }

    override fun onDestroy() {
        super.onDestroy()
        cameraExecutor.shutdown()
        faceDetector.close()
    }

    companion object {
        private const val TAG = "MainActivity"
    }
}
